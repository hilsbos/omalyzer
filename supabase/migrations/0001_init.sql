-- =============================================================================
-- 0001_init.sql — Omalyzer backend, Visibility Model B
-- (own oms only + corpus-wide anonymized aggregates; no individual ever sees
-- another user's raw row). Biometric voice data: RLS is safety-critical.
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto; present by default on Supabase, but be explicit.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- TABLES
-- -----------------------------------------------------------------------------

-- One row per user, mirrors auth.users. Public-safe profile fields only.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- One row per contributed om recording.
create table public.oms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade
                  default auth.uid(),
  created_at    timestamptz not null default now(),
  audio_path    text,                       -- Storage object key; null if features-only
  duration_secs real,
  vowel         text,
  note          text,
  f0_mean       real,
  sample_rate   real,
  device_label  text,
  mic_settings  jsonb,                       -- applied getSettings() covariates
  consent_share boolean not null default false  -- opt-in to be included in aggregates
);

-- Coherence + per-segment features for an om (1:1 or 1:many for multi-tone).
create table public.om_features (
  id              uuid primary key default gen_random_uuid(),
  om_id           uuid not null references public.oms (id) on delete cascade,
  coherence_index real,
  sub_metrics     jsonb,                     -- the five 0..1 sub-metrics
  hnr_db          real,
  jitter_cents    real,
  alpha_ratio_db  real,
  cpps_db         real,
  formants        jsonb,
  raw_features    jsonb                      -- wide/evolving Snapshot detail_* fields
);

-- Indexes that matter for the actual query paths.
create index oms_user_id_idx        on public.oms (user_id);
create index om_features_om_id_idx  on public.om_features (om_id);
-- Speeds the aggregate scan: only shared, non-null-coherence rows are ever read.
create index om_features_coherence_idx
  on public.om_features (coherence_index)
  where coherence_index is not null;

-- -----------------------------------------------------------------------------
-- PROFILE AUTO-CREATION (trigger on auth.users)
-- -----------------------------------------------------------------------------
-- Chosen over upsert-on-login because it is server-authoritative: the row exists
-- the instant the auth user exists, regardless of which client path signs them in
-- (magic link, OAuth, API), and it cannot be skipped, spoofed, or forgotten by the
-- frontend. An upsert-on-login depends on the client running the right code every
-- session and races with the first save; a SECURITY DEFINER trigger does not.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;   -- idempotent; never blocks signup
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.oms         enable row level security;
alter table public.om_features enable row level security;
-- Defense in depth: even the table owner is subject to RLS. (Supabase API roles
-- are not table owners, but this removes any owner-bypass footgun.)
alter table public.profiles    force row level security;
alter table public.oms         force row level security;
alter table public.om_features force row level security;

-- ---- profiles: a user sees and edits ONLY their own profile row ----
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_delete_own on public.profiles
  for delete to authenticated
  using (id = auth.uid());

-- ---- oms: a user sees and edits ONLY rows they own ----
create policy oms_select_own on public.oms
  for select to authenticated
  using (user_id = auth.uid());

-- WITH CHECK pins ownership: a client cannot insert a row attributed to anyone else,
-- even if it tries to set user_id explicitly (the column default is auth.uid()).
create policy oms_insert_own on public.oms
  for insert to authenticated
  with check (user_id = auth.uid());

create policy oms_update_own on public.oms
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());   -- can't re-home a row to another user

create policy oms_delete_own on public.oms
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- om_features: ownership is derived via the parent oms row ----
-- The child table has no user_id; access is gated by EXISTS against the parent's
-- ownership. Because the parent SELECT policy also fences to auth.uid(), there is
-- no way to read features whose om you do not own.
create policy om_features_select_own on public.om_features
  for select to authenticated
  using (exists (
    select 1 from public.oms o
    where o.id = om_features.om_id
      and o.user_id = auth.uid()
  ));

create policy om_features_insert_own on public.om_features
  for insert to authenticated
  with check (exists (
    select 1 from public.oms o
    where o.id = om_features.om_id
      and o.user_id = auth.uid()
  ));

create policy om_features_update_own on public.om_features
  for update to authenticated
  using (exists (
    select 1 from public.oms o
    where o.id = om_features.om_id
      and o.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.oms o
    where o.id = om_features.om_id
      and o.user_id = auth.uid()
  ));

create policy om_features_delete_own on public.om_features
  for delete to authenticated
  using (exists (
    select 1 from public.oms o
    where o.id = om_features.om_id
      and o.user_id = auth.uid()
  ));

-- -----------------------------------------------------------------------------
-- STORAGE: private bucket 'oms', objects keyed "{auth.uid()}/{om_id}.flac"
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('oms', 'oms', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase. These policies restrict the
-- 'oms' bucket to objects under the caller's own uid prefix. We match the first path
-- segment (storage.foldername(name))[1] against auth.uid()::text — the prefix is the
-- authoritative gate; do NOT rely on a "/" substring test, which an empty/odd key
-- could slip past.
create policy oms_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'oms'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy oms_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'oms'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy oms_objects_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'oms'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'oms'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy oms_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'oms'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- ANONYMIZED AGGREGATE RPC  (the only cross-user surface)
-- -----------------------------------------------------------------------------
-- Returns ONLY aggregates over shared rows. SECURITY DEFINER so it can read across
-- users (bypassing the per-row RLS above), but it is structurally incapable of
-- returning identifiers: the RETURNS TABLE exposes only n + percentiles, and the
-- body selects no user_id / id / audio_path / created_at. A small-n floor blocks
-- de-anonymisation when a vowel slice has too few contributors.
create or replace function public.community_coherence_stats(p_vowel text default null)
returns table (
  n      bigint,
  median double precision,
  p25    double precision,
  p75    double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with shared as (
    select f.coherence_index as ci
    from public.om_features f
    join public.oms o on o.id = f.om_id
    where o.consent_share = true
      and f.coherence_index is not null
      and (p_vowel is null or o.vowel = p_vowel)
  )
  select
    count(*)::bigint as n,
    case when count(*) >= 5
         then percentile_cont(0.50) within group (order by ci) end as median,
    case when count(*) >= 5
         then percentile_cont(0.25) within group (order by ci) end as p25,
    case when count(*) >= 5
         then percentile_cont(0.75) within group (order by ci) end as p75
  from shared;
$$;

-- Lock the execution surface: only logged-in users may call it; anon and the
-- generic PUBLIC grant are removed. (revoke is belt-and-suspenders for instances
-- where functions default-grant EXECUTE to PUBLIC.)
revoke all on function public.community_coherence_stats(text) from public;
revoke all on function public.community_coherence_stats(text) from anon;
grant execute on function public.community_coherence_stats(text) to authenticated;

-- -----------------------------------------------------------------------------
-- SELF-SERVE ACCOUNT DELETION
-- -----------------------------------------------------------------------------
-- Deletes the caller's OWN auth.users row — and only ever their own: auth.uid()
-- is the authenticated request subject, never a parameter, so a caller cannot
-- target anyone else. public.profiles / public.oms / public.om_features all
-- cascade via their `on delete cascade` FKs to auth.users, so every DB trace of
-- the user is removed in one statement.
--
-- IMPORTANT: storage.objects does NOT cascade from auth.users, so the client
-- MUST purge the user's Storage objects (their `{uid}/` prefix) BEFORE calling
-- this. SECURITY DEFINER is required to touch the auth schema; the function owner
-- (postgres, when applied via the SQL Editor / db push) has that privilege.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
