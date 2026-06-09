// oms.ts — typed reads of the user's own oms (RLS-scoped) and the community
// aggregate RPC. No cross-user data is ever fetched except the anonymized
// aggregates returned by community_coherence_stats.

import { supabase } from './supabase';

/** A row joining an om to its (1:1 here) features, newest first. */
export interface OmRow {
  id: string;
  created_at: string;
  audio_path: string | null;
  duration_secs: number | null;
  vowel: string | null;
  note: string | null;
  coherence_index: number | null;
}

interface RawOmRow {
  id: string;
  created_at: string;
  audio_path: string | null;
  duration_secs: number | null;
  vowel: string | null;
  note: string | null;
  om_features: Array<{ coherence_index: number | null }> | null;
}

/** Fetch the signed-in user's own oms (RLS confines this to their rows). */
export async function fetchMyOms(): Promise<OmRow[]> {
  const { data, error } = await supabase
    .from('oms')
    .select('id, created_at, audio_path, duration_secs, vowel, note, om_features ( coherence_index )')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data as RawOmRow[] | null ?? []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    audio_path: r.audio_path,
    duration_secs: r.duration_secs,
    vowel: r.vowel,
    note: r.note,
    coherence_index: r.om_features?.[0]?.coherence_index ?? null,
  }));
}

export interface CommunityStats {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

/** Call the anonymized-aggregate RPC (security definer, opt-in rows only). */
export async function fetchCommunityStats(vowel?: string | null): Promise<CommunityStats> {
  const { data, error } = await supabase.rpc('community_coherence_stats', {
    p_vowel: vowel ?? null,
  });
  if (error) throw new Error(error.message);
  // The RPC returns a single-row table.
  const row = (Array.isArray(data) ? data[0] : data) as CommunityStats | undefined;
  return row ?? { n: 0, median: null, p25: null, p75: null };
}
