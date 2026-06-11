import styles from './panels.module.css';
import InfoRow from './InfoRow';
import EvidenceDot from './EvidenceDot';
import type { Snapshot } from '../types/snapshot';

const dash = '—';

/**
 * State-signals panel: the last completed sustained tone's acoustic proxies for
 * autonomic state (F0 mean, F0 var, alpha-ratio, CPPS), plus the autonomic index
 * that comes online as a personal baseline builds. These are the readings a
 * personal vocal signature is built from.
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
      <h2 className={styles.panelTitle}>State signals</h2>
      <div className={styles.legend}>acoustic proxies for autonomic state, captured live</div>

      <InfoRow
        evidence="strong"
        name="F0 mean"
        raw={meanF0}
        caption="Average fundamental frequency over the held tone (Hz). As your baseline builds, it sharpens into a within-person state signal."
      />
      <InfoRow
        evidence="moderate"
        name="F0 var"
        raw={f0Var}
        caption="How much F0 wandered across the held tone, in semitones — the steadiness of vocal production. As your baseline builds, it sharpens into a within-person state signal."
      />
      <InfoRow
        evidence="moderate"
        name="α-ratio"
        raw={alpha}
        caption="Spectral tilt (low vs high band energy) averaged over the held tone, in dB — a read on tension and brightness. As your baseline builds, it sharpens into a within-person state signal."
      />
      <InfoRow
        evidence="moderate"
        name="CPPS"
        raw={cpps}
        caption="Smoothed cepstral peak prominence over the held tone, in dB — harmonic clarity and periodicity. As your baseline builds, it sharpens into a within-person state signal."
      />

      {/* The autonomic index — the inference layer that comes online as a
          personal baseline accumulates. */}
      <div className={styles.divider} role="separator">
        live readings │ your signature, forming
      </div>
      <div className={styles.placeholder} title="The autonomic index maps your vocal signature onto nervous-system state. It comes online as your personal baseline builds — a per-person centroid and a Mahalanobis distance from it.">
        <EvidenceDot evidence="experimental" />
        <span>Auto idx</span>
        <span className={styles.placeholderTag}>⚗ on the roadmap</span>
      </div>

      {!hasTone && (
        <div className={styles.legend}>{dash} hold a steady note ≥ 2.5 s for state signals</div>
      )}
    </section>
  );
}
