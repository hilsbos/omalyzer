import styles from './panels.module.css';
import InfoRow from './InfoRow';
import EvidenceDot from './EvidenceDot';
import type { Snapshot } from '../types/snapshot';

const dash = '—';

/**
 * State-signals panel: the last completed sustained tone's RAW acoustic
 * measurements (F0 mean, F0 var, alpha-ratio, CPPS) on the MEASURED side of the
 * measured│inferred divider, plus the deferred Autonomic Index placeholder.
 * Every string is verbatim from crates/desktop/src/ui.rs
 * draw_state_signals_panel. CRITICAL FRAMING: no value crosses the divider; the
 * Autonomic placeholder is never a number or a state word.
 */
export default function StateSignals({ snapshot }: { snapshot: Snapshot | null }) {
  const s = snapshot;
  const hasTone = s?.last_coherence_index != null;

  const meanF0 = s?.detail_mean_f0_hz != null ? `${s.detail_mean_f0_hz.toFixed(1)} Hz` : dash;
  const f0Var = s?.detail_f0_var_st != null ? `${s.detail_f0_var_st.toFixed(2)} st` : dash;
  const alpha =
    s?.detail_alpha_ratio_db != null
      ? `${s.detail_alpha_ratio_db >= 0 ? '+' : ''}${s.detail_alpha_ratio_db.toFixed(1)} dB`
      : dash;
  const cpps = s?.detail_cpps_db != null ? `${s.detail_cpps_db.toFixed(1)} dB` : dash;

  return (
    <section className={styles.panel} aria-label="State signals">
      <h2 className={styles.panelTitle}>
        State signals (raw — needs a personal baseline to interpret)
      </h2>
      <div className={styles.legend}>measured │ inferred (needs baseline)</div>

      <InfoRow
        evidence="strong"
        name="F0 mean"
        raw={meanF0}
        caption="Average fundamental frequency over the held tone (Hz) — a raw measurement. It will become a within-person signal once a baseline exists."
      />
      <InfoRow
        evidence="moderate"
        name="F0 var"
        raw={f0Var}
        caption="How much F0 wandered across the held tone, in semitones — a raw measurement of vocal-production steadiness. It will become a within-person signal once a baseline exists."
      />
      <InfoRow
        evidence="moderate"
        name="α-ratio"
        raw={alpha}
        caption="Spectral tilt (low vs high band energy) averaged over the held tone, in dB — a raw measurement. It will become a within-person signal once a baseline exists."
      />
      <InfoRow
        evidence="moderate"
        name="CPPS"
        raw={cpps}
        caption="Smoothed cepstral peak prominence over the held tone, in dB — a raw measure of harmonic clarity / periodicity. It will become a within-person signal once a baseline exists."
      />

      {/* The measured│inferred divider — the inferred side carries only the
          deferred placeholder, never a number or a state word. */}
      <div className={styles.divider} role="separator">
        measured │ inferred (needs baseline)
      </div>
      <div className={styles.placeholder} title="Experimental, deferred. An autonomic index would require a personal baseline centroid (a Mahalanobis distance from it) that this build does not yet keep. Placeholder only.">
        <EvidenceDot evidence="experimental" />
        <span>Auto idx</span>
        <span className={styles.placeholderTag}>⚗ needs baseline</span>
      </div>

      {!hasTone && (
        <div className={styles.legend}>{dash} hold a steady note ≥ 2.5 s for state signals</div>
      )}
    </section>
  );
}
