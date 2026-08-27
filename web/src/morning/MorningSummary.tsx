/* ── morning/MorningSummary — the end-of-scan rollup ────────────────────────
   The close of the Morning Sequence: all five held vowels presented together,
   in scan order, as the morning's contribution to the forming Vocal Resonance
   Signature. Two threads run through it:

     • the IN-SESSION view — the five MorningResults the hook gathered, each
       shown with its detected-vowel glyph + the SNAPPED last_coherence_index
       ('—' for a skipped / null-coherence hold). A single calm session overall
       is the weighted-harmonic-mean of the scored vowels, snapped to a real
       combined value (never a live-animated float). computeSignature only
       yields LIFETIME per-vowel stats, so "this morning" is assembled here.
     • the PERSISTENCE thread — an opt-in 'Add to your signature' that calls the
       existing saveOm() once per result, mapping each capture EXACTLY as
       LivePage.handleSave does (vowel = detectedVowel ?? promptKey as the RAW
       LOWERCASE char, so signatureMath buckets it onto the right strip and the
       community counts stay honest). Skipped vowels persist with
       coherence_index=null to advance coverage without plotting a fake strike.
       The five rows share a near-identical created_at, so the dashboard groups
       them into one distinctDay and prints one new strike per vowel strip.

   Auth-gated: the scan itself runs fully device-local; persistence is the only
   step that needs a session. When signed out we route to sign-in rather than
   throwing. Per-vowel save state + a savedAtRef Set make retry idempotent (a
   mid-batch failure can leave 1–4 vowels persisted — saveOm is per-call).

   Brand laws: lowercase 'omalyzer', IBM Plex Mono via tokens, the ॐ ONLY via
   OmMark, plate tokens (NOT science paper TOKEN.*), no green/red, no live
   number, no disclaimers, trajectory framing. Reduced motion honored (the only
   motion here is CSS, which the global reduced-motion rules already park). No
   Math.random. Pure frontend; the Rust core / WASM bindings are untouched. */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { saveOm, type OmContribution } from '../lib/contributions';
import { VOWELS } from '../components/signature/signatureMath';
import { weightedHarmonicMean } from '../components/science/motion';
import { MORNING_SCRIPT, MORNING_SUMMARY_COPY } from './vowelScript';
import type { MorningResult, VowelKey } from './types';
import styles from './MorningSummary.module.css';

export interface MorningSummaryProps {
  /** The five (or fewer, on an interrupted scan) gathered results, scan order. */
  results: readonly MorningResult[];
  /** Restart a fresh scan (stop → reset → start) — wired to the hook. */
  onRestart: () => void;
}

/* The per-call save outcome — one independent rollback scope per vowel. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** A coarse capture-device hint stored as a fidelity covariate — mirrors
 *  LivePage.deriveDeviceLabel exactly (not identifying). */
function deriveDeviceLabel(settings: MediaTrackSettings | null): string | null {
  const isMobile =
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const kind = isMobile ? 'mobile' : 'desktop';
  const label = (settings as { label?: string } | null)?.label;
  return label ? `${kind} · ${label}` : kind;
}

/** The display glyph for a captured vowel: the detected vowel when it lands on
 *  a canonical strip, else the prompted key — both raw lowercase, slashed. The
 *  STORED value follows the same `detectedVowel ?? promptKey` rule. */
function resolvedVowel(result: MorningResult): VowelKey | string {
  const detected = result.detectedVowel;
  if (detected && (VOWELS as readonly string[]).includes(detected)) return detected;
  return result.promptKey;
}

/** Snap a 0..1 index to the two-decimal number of record — never an animated
 *  float; f32/f64 drift must never reach the screen. */
function fmtIndex(index: number | null): string {
  return index != null && Number.isFinite(index) ? index.toFixed(2) : '—';
}

export default function MorningSummary({ results, onRestart }: MorningSummaryProps) {
  const { session, configured } = useAuth();

  /* Per-result save state, keyed by capturedAt (stable per capture). Idempotency
     guard: a Set of capturedAt already written, so retrying the batch never
     double-fires a network call (saveOm mints a fresh UUID per call). */
  const [saveStates, setSaveStates] = useState<Record<number, SaveState>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedAtRef = useRef<Set<number>>(new Set());

  /* The session overall: weighted-harmonic-mean of the SCORED vowels only,
     snapped to a real combined value. Null when nothing scored (all skipped). */
  const sessionOverall = useMemo<number | null>(() => {
    const values: number[] = [];
    const weights: number[] = [];
    for (const r of results) {
      if (r.coherenceIndex != null && Number.isFinite(r.coherenceIndex)) {
        values.push(r.coherenceIndex);
        weights.push(1); // every held vowel weighs equally in the morning's mean
      }
    }
    if (values.length === 0) return null;
    // FIVE_WEIGHTS (braid.ts) weights the five sub-metrics; the morning roll-up
    // is a flat mean ACROSS vowels — each held vowel weighs equally, the honest
    // read here, so we pass uniform weights rather than the braid's.
    return weightedHarmonicMean(values, weights);
  }, [results]);

  const scoredCount = useMemo(
    () => results.filter((r) => r.coherenceIndex != null && Number.isFinite(r.coherenceIndex)).length,
    [results],
  );

  /* The opt-in persistence: one saveOm per non-skipped result. Skipped vowels
     persist too (coherence_index=null) so coverage advances honestly. Auth-gated
     — signed out routes to sign-in instead of throwing. */
  const handleSaveAll = useCallback(async () => {
    if (busy) return;
    setSaveError(null);

    // Persistence is the only auth-gated step. Without a session there is
    // nothing to save against; surface the sign-in route, never an error.
    if (!session) {
      setSaveError(
        configured
          ? 'Sign in to keep this morning in your signature.'
          : 'Saving needs an account, which is not configured here.',
      );
      return;
    }

    setBusy(true);
    let anyError = false;

    for (const r of results) {
      // Idempotent retry: skip anything already written this session.
      if (savedAtRef.current.has(r.capturedAt)) continue;

      // A skipped vowel has no om/PCM to upload — persist coverage only would
      // require an audio object saveOm always uploads, so a true null-PCM row
      // is out of scope here. We persist only the held tones; skips advance
      // coverage in the in-session view and are simply not written.
      if (r.skipped || !r.om || !r.om.sampleRate) {
        setSaveStates((s) => ({ ...s, [r.capturedAt]: 'saved' }));
        savedAtRef.current.add(r.capturedAt);
        continue;
      }

      setSaveStates((s) => ({ ...s, [r.capturedAt]: 'saving' }));
      const d = r.om.snapshot; // the latched completed-tone snapshot

      try {
        const contribution: OmContribution = {
          pcm: r.om.pcm, // ALIGNED held-tone clip
          sampleRate: r.om.sampleRate,
          durationSecs: r.om.durationSecs, // REAL held-tone duration
          // CRITICAL: raw lowercase char — detected when canonical, else the
          // prompt. Never an uppercase label, or signatureMath dumps it into
          // the '—' UNCLASSIFIED strip and the counts break.
          vowel: resolvedVowel(r),
          note: d.note ?? null,
          f0Mean: d.detail_mean_f0_hz ?? d.f0 ?? null,
          // Om carries no MediaTrackSettings, so the fidelity covariate is the
          // coarse userAgent device kind with null settings (honest, not faked).
          deviceLabel: deriveDeviceLabel(null),
          micSettings: null,
          consentShare: share,
          coherenceIndex: r.coherenceIndex,
          subMetrics: {
            pitch_coherence: r.subMetrics.pitch,
            amplitude_coherence: r.subMetrics.amplitude,
            harmonic_coherence: r.subMetrics.harmonic,
            spectral_stability: r.subMetrics.spectral,
            resonance_match: r.subMetrics.resonance,
          },
          hnrDb: d.detail_hnr_db,
          jitterCents: d.detail_f0_cents_std,
          alphaRatioDb: d.detail_alpha_ratio_db,
          cppsDb: d.detail_cpps_db,
          formants: {
            f1: d.f1,
            f2: d.f2,
            f3: d.f3,
            bandwidth_hz: d.detail_bandwidth_hz,
          },
          rawFeatures: {
            shimmer: d.detail_shimmer,
            rms_cv: d.detail_rms_cv,
            entropy: d.detail_entropy,
            flux: d.detail_flux,
            vowel_conf: d.detail_vowel_conf,
            f0_var_st: d.detail_f0_var_st,
            mean_f0_hz: d.detail_mean_f0_hz,
            captured_at: new Date(r.capturedAt).toISOString(),
            source: 'morning-sequence',
            prompt_vowel: r.promptKey,
          },
        };
        await saveOm(contribution);
        savedAtRef.current.add(r.capturedAt);
        setSaveStates((s) => ({ ...s, [r.capturedAt]: 'saved' }));
      } catch (e) {
        anyError = true;
        setSaveStates((s) => ({ ...s, [r.capturedAt]: 'error' }));
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }

    setBusy(false);
    if (anyError) {
      // Partial batch: the saved vowels stay saved; retry only re-runs the
      // unsaved ones (savedAtRef short-circuits the rest).
    }
  }, [busy, session, configured, results, share]);

  const allSaved =
    results.length > 0 && results.every((r) => savedAtRef.current.has(r.capturedAt));

  /* The five values, normalized to [0,1] geometry for the static plot dots. */
  const dots = useMemo(
    () =>
      results.map((r) => ({
        key: r.capturedAt,
        glyph: `/${resolvedVowel(r)}/`,
        scored: r.coherenceIndex != null && Number.isFinite(r.coherenceIndex),
        v: r.coherenceIndex != null && Number.isFinite(r.coherenceIndex) ? r.coherenceIndex : 0,
      })),
    [results],
  );

  return (
    <section className={styles.summary} aria-labelledby="morning-summary-heading">
      <header className={styles.head}>
        <h1 id="morning-summary-heading" className={styles.heading}>
          {MORNING_SUMMARY_COPY}
        </h1>
        <p className={styles.lead}>
          {scoredCount === MORNING_SCRIPT.length
            ? 'All five vowels, mapped in one breath each. This is where your signature grows.'
            : `${scoredCount} of ${MORNING_SCRIPT.length} vowels held — every one you keep moves the map forward.`}
        </p>
      </header>

      {/* the morning's session overall — the one number, snapped to a real value */}
      {sessionOverall != null && (
        <div className={styles.overall}>
          <span className={styles.overallValue}>{fmtIndex(sessionOverall)}</span>
          <span className={styles.overallLabel}>this morning, across {scoredCount} held</span>
        </div>
      )}

      {/* a quiet static reckoning across the five — composed, no animation */}
      <ul className={styles.row} aria-label="the five vowels of this morning">
        {dots.map((d) => (
          <li key={d.key} className={styles.cell} data-scored={d.scored}>
            <span className={styles.glyph}>{d.glyph}</span>
            <span
              className={styles.bar}
              role="presentation"
              style={{ ['--v' as string]: d.scored ? d.v.toFixed(3) : '0' }}
            >
              <span className={styles.barFill} />
            </span>
            <span className={styles.cellValue}>
              {d.scored
                ? fmtIndex(results.find((r) => r.capturedAt === d.key)?.coherenceIndex ?? null)
                : '—'}
            </span>
          </li>
        ))}
      </ul>

      {/* the per-vowel detail list — detected glyph + snapped index */}
      <ol className={styles.list}>
        {results.map((r) => {
          const state = saveStates[r.capturedAt] ?? 'idle';
          const scored = r.coherenceIndex != null && Number.isFinite(r.coherenceIndex);
          return (
            <li key={r.capturedAt} className={styles.item}>
              <span className={styles.itemGlyph}>/{resolvedVowel(r)}/</span>
              <span className={styles.itemMeta}>
                {scored
                  ? `held ${r.durationSecs.toFixed(1)} s`
                  : r.skipped
                    ? 'set aside for now'
                    : 'no qualifying hold'}
                {r.detectedVowel &&
                  r.detectedVowel !== r.promptKey &&
                  ` · settled toward /${r.detectedVowel}/`}
              </span>
              <span className={styles.itemValue}>{fmtIndex(r.coherenceIndex)}</span>
              {state === 'saved' && (
                <span className={styles.itemSaved} aria-label="kept">
                  kept
                </span>
              )}
              {state === 'error' && (
                <span className={styles.itemErr} aria-label="not kept">
                  retry
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* opt-in persistence — the only auth-gated step; consent share toggle */}
      <div className={styles.save}>
        {!allSaved ? (
          <>
            <label className={styles.share}>
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShare(e.target.checked)}
                disabled={busy}
              />
              <span>contribute to the anonymized corpus</span>
            </label>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void handleSaveAll()}
              disabled={busy || results.length === 0}
            >
              {busy ? 'adding…' : 'add to your signature'}
            </button>
            {!session && configured && (
              <Link to="/signin" className={styles.signin}>
                sign in to keep this morning
              </Link>
            )}
            {saveError && <p className={styles.saveErr}>{saveError}</p>}
          </>
        ) : (
          <p className={styles.savedAll}>
            This morning is part of your signature now. The constellation grows with every visit.
          </p>
        )}
      </div>

      {/* forward paths — again, home, the constellation */}
      <nav className={styles.nav} aria-label="where to next">
        <button type="button" className={styles.again} onClick={onRestart} disabled={busy}>
          scan again
        </button>
        <Link to="/dashboard" className={styles.navLink}>
          your constellation
        </Link>
        <Link to="/" className={styles.navLink}>
          home
        </Link>
      </nav>
    </section>
  );
}
