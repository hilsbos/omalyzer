import styles from './panels.module.css';
import CoherenceBar from './CoherenceBar';
import InfoRow from './InfoRow';
import type { Snapshot } from '../types/snapshot';

const dash = '—';
const f2 = (v: number | null | undefined) => (v == null ? dash : v.toFixed(2));

/**
 * Vocal Coherence panel: overall index bar + the five acoustic sub-metrics, each
 * tap-to-expand. The numeric formats track crates/desktop/src/ui.rs
 * draw_coherence_panel; the web copy is its own.
 */
export default function CoherencePanel({ snapshot }: { snapshot: Snapshot | null }) {
  const s = snapshot;
  const hasTone = s?.last_coherence_index != null;
  const vowel = s?.last_coherence_vowel ?? null;
  const secs = s?.last_coherence_secs ?? 0;
  const live = s?.live_coherence_index ?? null;

  const header = hasTone
    ? vowel
      ? `Vocal Coherence (sustained /${vowel}/, ${secs.toFixed(1)} s)`
      : `Vocal Coherence (sustained tone, ${secs.toFixed(1)} s)`
    : 'Vocal Coherence (sustained tone) — hold a steady note ≥ 2.5 s';

  // Raw natural-unit formats, matching ui.rs sub_metric raw text.
  const ampRaw =
    s?.detail_shimmer != null
      ? `shimmer ${(s.detail_shimmer * 100).toFixed(1)}%`
      : s?.detail_rms_cv != null
        ? `RMS cv ${s.detail_rms_cv.toFixed(2)}`
        : dash;
  const harmRaw =
    s?.detail_hnr_db != null && s?.detail_entropy != null
      ? `HNR ${s.detail_hnr_db.toFixed(0)} dB · entropy ${s.detail_entropy.toFixed(2)}`
      : dash;
  const resRaw =
    s?.detail_vowel_conf != null
      ? s.detail_bandwidth_hz != null
        ? `vowel ${(s.detail_vowel_conf * 100).toFixed(0)}% · bw ${s.detail_bandwidth_hz.toFixed(0)} Hz`
        : `vowel ${(s.detail_vowel_conf * 100).toFixed(0)}%`
      : dash;

  return (
    <section className={styles.panel} aria-label="Vocal Coherence">
      <h2 className={styles.panelTitle}>
        {header}
        {live != null && (
          // --data-high-plate, not --hold-green: #5E7E55 is ~3.9:1 on the
          // #14171F plate — the plate register passes where the paper one fails.
          <span style={{ color: 'var(--data-high-plate)', marginLeft: '0.5rem' }}>
            · holding… {live.toFixed(2)}
          </span>
        )}
      </h2>

      {hasTone && (
        <div className={styles.legend}>0 = unstable / noisy … 1 = steady / clear</div>
      )}
      <div className={styles.scopeNote}>
        how steadily the whole tone holds together
      </div>

      <div className={styles.indexRow}>
        <span className={styles.indexLabel}>
          index {s?.last_coherence_index != null ? s.last_coherence_index.toFixed(2) : dash}
        </span>
        <CoherenceBar value={s?.last_coherence_index ?? null} height={14} ariaLabel="overall index" variant="plate" />
      </div>

      <InfoRow
        name="pitch"
        raw={s?.detail_f0_cents_std != null ? `F0 ±${s.detail_f0_cents_std.toFixed(0)} c` : dash}
        barValue={s?.pitch_coherence ?? null}
        caption="Pitch steadiness — how little F0 wandered across the held tone (cents std-dev). Lower wander → higher score."
      />
      <InfoRow
        name="amplitude"
        raw={ampRaw}
        barValue={s?.amplitude_coherence ?? null}
        caption="Loudness steadiness — cycle-to-cycle amplitude variation (shimmer), or RMS variation when shimmer isn't measurable."
      />
      <InfoRow
        name="harmonic"
        raw={harmRaw}
        barValue={s?.harmonic_coherence ?? null}
        caption="Harmonic clarity — harmonics-to-noise ratio plus spectral order (low entropy = clean, ordered harmonics)."
      />
      <InfoRow
        name="spectral"
        raw={s?.detail_flux != null ? `flux ${s.detail_flux.toFixed(3)}` : dash}
        barValue={s?.spectral_stability ?? null}
        caption="Spectral stability — how little the spectrum changed frame-to-frame (flux). Lower flux → higher score."
      />
      <InfoRow
        name="resonance"
        raw={resRaw}
        barValue={s?.resonance_match ?? null}
        caption="Resonance support — how cleanly the vowel matched a target and how sharp (narrow-bandwidth) the formants were."
      />

      <div className={styles.scopeNote}>
        The weighted harmonic mean of five dimensions. (Sub-metric values:{' '}
        {f2(s?.pitch_coherence)} / {f2(s?.amplitude_coherence)} / {f2(s?.harmonic_coherence)} /{' '}
        {f2(s?.spectral_stability)} / {f2(s?.resonance_match)}.)
      </div>
    </section>
  );
}
