import CoherenceBar from './CoherenceBar';
import styles from './Hero.module.css';
import type { Snapshot } from '../types/snapshot';

const dash = '—';

export interface HeroProps {
  snapshot: Snapshot | null;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}

/**
 * Primary always-visible readout: Start/Stop, vowel, pitch, and the single
 * overall coherence index with a live "holding…" preview. The at-a-glance face
 * of the analyzer.
 */
export default function Hero({ snapshot, running, onStart, onStop }: HeroProps) {
  const s = snapshot;
  const voiced = !!s?.voiced;

  const vowel =
    voiced && s?.vowel ? `${s.vowel} (${(s.vowel_conf * 100).toFixed(0)}%)` : dash;
  const pitch =
    voiced && s?.f0 != null
      ? `${s.f0.toFixed(1)} Hz · ${s.note ?? dash}`
      : dash;

  const live = s?.live_coherence_index ?? null;
  const last = s?.last_coherence_index ?? null;
  const shownIndex = live ?? last;

  return (
    <section className={styles.hero} aria-label="Primary readout">
      <button
        type="button"
        className={styles.startStop}
        data-running={running}
        onClick={running ? onStop : onStart}
      >
        {running ? 'Stop' : 'Start'}
      </button>

      <div className={styles.readouts}>
        <Readout label="vowel" value={vowel} />
        <Readout label="pitch" value={pitch} />
      </div>

      <div className={styles.dial}>
        <div className={styles.dialHead}>
          <span className={styles.dialLabel}>coherence</span>
          <span className={styles.dialValue}>
            {shownIndex != null ? shownIndex.toFixed(2) : dash}
            {live != null && <span className={styles.holding}> holding…</span>}
          </span>
        </div>
        <CoherenceBar value={shownIndex} height={12} ariaLabel="vocal coherence index" />
      </div>
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>{label}</span>
      <span className={styles.readoutValue}>{value}</span>
    </div>
  );
}
