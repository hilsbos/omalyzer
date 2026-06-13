# Omalyzer Supabase backend

This directory holds the database schema for the Omalyzer web community
features (Visibility **Model B**: each user sees only their own raw `oms`
recordings, plus corpus-wide *anonymized aggregates* — no individual ever sees
another user's raw row).

## Files

- `migrations/0001_init.sql` — tables (`profiles`, `oms`, `om_features`),
  row-level security, the private `oms` storage bucket and its object policies,
  the `community_coherence_stats` `SECURITY DEFINER` aggregate RPC, and the
  `profiles` auto-create trigger on `auth.users`.

## How to apply

You need a Supabase project. The frontend reads its URL + anon key from
`web/.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

### Option A — Supabase CLI (recommended; keeps schema versioned)

```sh
# from the repo root, with the CLI installed and the project linked
supabase db push        # applies pending migrations to the linked project
# or, against a local stack:
supabase db reset       # replays all migrations from scratch
```

If your CLI version expects timestamp-prefixed filenames, rename to e.g.
`20260608000000_init.sql`.

### Option B — Dashboard SQL Editor

1. Open the Supabase project → **SQL Editor** → new query.
2. Paste the entire contents of `migrations/0001_init.sql`.
3. **Run.**

The extension / bucket-insert / trigger-function pieces are idempotent, but the
`create table` / `create policy` statements are not re-runnable — for a fresh
project this is one clean run. The `storage` schema already exists on any
Supabase project, so no extra setup is needed for the bucket policies.

## Dashboard runbook for magic-link auth (must be done in the dashboard)

1. **Authentication → Providers → Email**: enable the Email provider. Magic
   links need no client-side password setup (`signInWithOtp` handles it).
2. **Authentication → URL Configuration → Site URL**: set to your production
   origin (e.g. `https://omalyzer.com`).
3. **Authentication → URL Configuration → Redirect URLs**: add both
   `http://localhost:5173` (Vite dev) and your production origin. (The app no
   longer uses `emailRedirectTo`, but keeping these allow-listed is harmless.)
4. **Authentication → Email Templates → Magic Link** — REQUIRED for the
   code-based sign-in: the template body MUST use the numeric token, not the
   link. Replace `{{ .ConfirmationURL }}` with `{{ .Token }}` (e.g. "Your
   omalyzer sign-in code is **{{ .Token }}**. It expires shortly."). If the
   template still emits a URL, users receive a link instead of a code and the
   in-app code field has nothing to verify.
   - Apply `{{ .Token }}` to BOTH the **Magic Link** AND the **Confirm signup**
     templates — `signInWithOtp` uses Confirm signup for brand-new emails and
     Magic Link for existing users; a link left in either one sends a link.
     Never keep `{{ .Token }}` and `{{ .ConfirmationURL }}` together in one
     template (the dual link+code form is an upstream bug and scanner-fragile).
   - **Authentication → Sign In / Providers → Email → Email OTP Length**: keep
     at **6**. The sibling project (twentytwo, same Supabase patterns) set it to
     8 once and bricked sign-in; 6 is the proven value. The app's code field
     tolerates 6–10 so a drift degrades instead of blocking, but 6 is assumed.
   - **Email OTP Expiry**: the default (~1 hour) is fine; lower it if desired.

5. **Authentication → Emails → SMTP Settings** (custom SMTP, so codes send
   reliably instead of via Supabase's rate-limited built-in mailer). Mirrors the
   twentytwo project — same AWS account (022103836148), same verified domain:
   - Sender: `omalyzer <code@shushu.be>` — domain identity `shushu.be` is
     verified (DKIM SUCCESS) in SES **us-east-1**; any `@shushu.be` sender works
     with no extra verification.
   - Host/port: `email-smtp.us-east-1.amazonaws.com` : `465`.
   - Username/password: the AWS SES SMTP credentials of the send-only IAM user
     `twentytwo-ses-smtp` (reused — same creds as the twentytwo project's
     Supabase SMTP settings).
   - **SES is in SANDBOX** (account-wide; production access still pending). In
     sandbox SES delivers only to VERIFIED identities (`patrick@hilsbos.com`).
     Until production access is granted, other recipients (e.g. new crew) must
     be added as verified SES identities or they receive nothing. Check:
     `aws --profile hilsbos sesv2 get-account --region us-east-1`.
6. **Project Settings → API**: copy **Project URL** → `VITE_SUPABASE_URL` and
   the **anon/public** key → `VITE_SUPABASE_ANON_KEY` in `web/.env.local`.
   Never put the `service_role` key in the frontend.

## Threat-model note — what the RLS / RPC design prevents

- **`force row level security` on all three tables** closes the table-owner
  bypass: even a misconfigured/elevated connection still obeys the per-row
  fence.
- **`oms` SELECT `user_id = auth.uid()`** prevents reading or enumerating
  anyone else's recordings, even with a guessed `oms.id` — the row simply isn't
  visible.
- **`oms` INSERT `with check (user_id = auth.uid())`** prevents attributing a
  recording to another user (identity spoofing / planting data in someone's
  journal). The column default sets it; the CHECK enforces it even against an
  explicit client value.
- **`oms` UPDATE has both USING and WITH CHECK** — USING blocks editing rows you
  don't own; WITH CHECK blocks "re-homing" a row to another `user_id` (a classic
  RLS gap when only USING is set).
- **`om_features` EXISTS-on-parent gate** — the child has no `user_id`, so
  ownership is derived from `oms`. The EXISTS check runs with the caller's
  privileges, so it cannot see foreign parent rows; INSERT/UPDATE WITH CHECK
  prevent grafting features onto someone else's om.
- **`profiles` own-row policies** — a profile is only visible/editable by its
  owner, so `display_name` is not harvestable across users in Model B.
- **Storage prefix policies** — a user can only read/write/delete objects under
  `"{their uid}/..."`, protecting the highest-risk asset (raw biometric audio)
  even if an object key is known. Matching `(storage.foldername(name))[1]`
  (first path segment) is stronger than a `like 'uid/%'` substring test a
  crafted key could evade.
- **Profile-creation trigger (`security definer`)** — guarantees every auth user
  has a profile row server-side, removing the race/omission risk of a
  client-side upsert.

### Why the aggregate RPC cannot leak an individual row

1. **No identifying columns exist in the result shape.** `RETURNS TABLE (n,
   median, p25, p75)` — there is no `user_id`, `id`, `audio_path`, etc. Even
   running as `SECURITY DEFINER`, all it can return is four numbers.
2. **It only ever touches consented rows** (`where o.consent_share = true`,
   which defaults to `false`).
3. **`set search_path = public`** pins name resolution, blocking the classic
   `SECURITY DEFINER` schema-shadowing attack.
4. **Small-n suppression.** Percentiles are returned only when `count(*) >= 5`;
   below that, `median/p25/p75` come back `null` while `n` still shows the small
   count. Tune the floor per privacy appetite.
5. **Execution is locked to `authenticated`** (`revoke ... from public/anon` +
   `grant execute ... to authenticated`) — anonymous visitors can't call it.

Residual product note: percentiles plus a controllable `p_vowel` filter are a
differential-privacy-style surface (repeatedly slicing and comparing `n` across
filters can leak membership at the margins). The `n >= 5` floor mitigates the
worst case; if the corpus stays small, consider rounding `n` to a bucket or
widening the floor before exposing it publicly.
