// contributions.ts — the Model B "save an om" flow: encode captured PCM to FLAC,
// upload it to the user's private prefix in the `oms` Storage bucket, then insert
// the `oms` + `om_features` rows from the in-memory analysis. No new DSP: every
// value comes from the snapshot/record result the analyzer already produced.
//
// On any failure after the upload, the orphaned Storage object is removed so we
// never leave a file with no row pointing at it.

import { requireSupabase } from './supabase';
import { pcmToWavBlob } from './wav';

/** The analysis payload the LivePage record produces, flattened for storage. */
export interface OmContribution {
  /** captured mono PCM at `sampleRate` (the FLAC source). */
  pcm: Float32Array;
  sampleRate: number;
  durationSecs: number;
  vowel: string | null;
  note: string | null;
  f0Mean: number | null;
  /** human-readable capture device hint (mobile/desktop + any label). */
  deviceLabel: string | null;
  /** full track.getSettings() — the fidelity covariate. */
  micSettings: MediaTrackSettings | null;
  /** opt-in to community aggregates (consent_share). */
  consentShare: boolean;

  // om_features
  coherenceIndex: number | null;
  subMetrics: {
    pitch_coherence: number | null;
    amplitude_coherence: number | null;
    harmonic_coherence: number | null;
    spectral_stability: number | null;
    resonance_match: number | null;
  };
  hnrDb: number | null;
  jitterCents: number | null;
  alphaRatioDb: number | null;
  cppsDb: number | null;
  formants: {
    f1: number | null;
    f2: number | null;
    f3: number | null;
    bandwidth_hz: number | null;
  };
  /** the rest of the snapshot detail block (shimmer, rms_cv, entropy, etc.). */
  rawFeatures: Record<string, unknown>;
}

export interface SavedOm {
  id: string;
  audioPath: string;
}

/**
 * Encode -> upload -> insert oms -> insert om_features, with storage rollback on
 * partial failure. Requires an authenticated session (RLS fences every write to
 * the caller's own user_id / prefix).
 */
export async function saveOm(c: OmContribution): Promise<SavedOm> {
  const supabase = requireSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    throw new Error('You must be signed in to save an om.');
  }
  const userId = userData.user.id;
  const omId = crypto.randomUUID();
  const audioPath = `${userId}/${omId}.wav`;

  // 1. encode the retained PCM to WAV (pure JS, synchronous).
  const blob = pcmToWavBlob(c.pcm, c.sampleRate);

  // 2. upload to the private bucket under the user's own prefix.
  const { error: upErr } = await supabase.storage
    .from('oms')
    .upload(audioPath, blob, { contentType: 'audio/wav', upsert: false });
  if (upErr) throw new Error(`Audio upload failed: ${upErr.message}`);

  // From here, roll the object back on any failure.
  try {
    // 3. insert the oms row (id = omId; user_id defaults to auth.uid()).
    const { error: omErr } = await supabase.from('oms').insert({
      id: omId,
      audio_path: audioPath,
      duration_secs: c.durationSecs,
      vowel: c.vowel,
      note: c.note,
      f0_mean: c.f0Mean,
      sample_rate: c.sampleRate,
      device_label: c.deviceLabel,
      mic_settings: c.micSettings,
      consent_share: c.consentShare,
    });
    if (omErr) throw new Error(`Saving recording metadata failed: ${omErr.message}`);

    // 4. insert the om_features row (FK om_id).
    const { error: featErr } = await supabase.from('om_features').insert({
      om_id: omId,
      coherence_index: c.coherenceIndex,
      sub_metrics: c.subMetrics,
      hnr_db: c.hnrDb,
      jitter_cents: c.jitterCents,
      alpha_ratio_db: c.alphaRatioDb,
      cpps_db: c.cppsDb,
      formants: c.formants,
      raw_features: c.rawFeatures,
    });
    if (featErr) {
      // best-effort: remove the parent row too (cascade only runs on delete).
      await supabase.from('oms').delete().eq('id', omId);
      throw new Error(`Saving features failed: ${featErr.message}`);
    }
  } catch (e) {
    await supabase.storage.from('oms').remove([audioPath]);
    throw e;
  }

  return { id: omId, audioPath };
}

/** Delete an om completely: its Storage object, then the row (cascades features).
 *
 * The biometric audio is removed FIRST and its failure is surfaced, so we never
 * report a recording deleted while its FLAC lingers orphaned in the bucket. If
 * the row delete then fails the caller can retry; the (idempotent) audio removal
 * has already guaranteed the sensitive data is gone. */
export async function deleteOm(id: string, audioPath: string | null): Promise<void> {
  const supabase = requireSupabase();
  if (audioPath) {
    const { error: rmErr } = await supabase.storage.from('oms').remove([audioPath]);
    if (rmErr) throw new Error(`Removing audio failed: ${rmErr.message}`);
  }
  const { error } = await supabase.from('oms').delete().eq('id', id);
  if (error) throw new Error(`Delete failed: ${error.message}`);
}

/**
 * Permanently delete the signed-in user's entire account and ALL their data:
 * purge every audio object under their Storage prefix, then call the
 * `delete_my_account` RPC, which removes the auth.users row (profiles / oms /
 * om_features cascade). Storage is purged FIRST because it does not cascade from
 * auth.users. The caller should sign out and redirect afterwards.
 */
export async function deleteMyAccount(): Promise<void> {
  const supabase = requireSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error('You must be signed in.');
  const userId = userData.user.id;

  // 1. Purge all of this user's audio objects (everything under their uid/ prefix).
  //    list() is the authoritative source — it catches any object even if a row
  //    is missing. (limit 1000 covers any realistic personal corpus.)
  const { data: objects, error: listErr } = await supabase.storage
    .from('oms')
    .list(userId, { limit: 1000 });
  if (listErr) throw new Error(`Listing your audio failed: ${listErr.message}`);
  if (objects && objects.length > 0) {
    const paths = objects.map((o) => `${userId}/${o.name}`);
    const { error: rmErr } = await supabase.storage.from('oms').remove(paths);
    if (rmErr) throw new Error(`Removing your audio failed: ${rmErr.message}`);
  }

  // 2. Delete the auth user (cascades profiles/oms/om_features). RLS-safe: the
  //    RPC only ever deletes auth.uid()'s own row.
  const { error: rpcErr } = await supabase.rpc('delete_my_account');
  if (rpcErr) throw new Error(`Account deletion failed: ${rpcErr.message}`);
}
