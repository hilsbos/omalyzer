import { useId, useState, type ReactNode } from 'react';
import styles from './panels.module.css';
import CoherenceBar from './CoherenceBar';
import EvidenceDot, { type Evidence } from './EvidenceDot';

/**
 * A tap/click info row: >=44px target whose whole surface toggles an
 * always-readable caption (the touch replacement for egui `.on_hover_text`). The
 * caption is mirrored via aria-describedby for screen readers. Optionally shows
 * an evidence dot (state signals) and/or a 0..1 coherence bar (sub-metrics).
 */
export interface InfoRowProps {
  name: ReactNode;
  raw?: ReactNode;
  caption: string;
  evidence?: Evidence;
  /** When provided, render a 0..1 bar after the head line. */
  barValue?: number | null;
  defaultOpen?: boolean;
}

export default function InfoRow({
  name,
  raw,
  caption,
  evidence,
  barValue,
  defaultOpen = false,
}: InfoRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const capId = useId();
  const showBar = barValue !== undefined;
  return (
    <button
      type="button"
      className={styles.row}
      aria-expanded={open}
      aria-describedby={capId}
      onClick={() => setOpen((o) => !o)}
    >
      <span className={styles.rowHead}>
        {evidence && <EvidenceDot evidence={evidence} />}
        <span className={styles.rowName}>{name}</span>
        {showBar && (
          <CoherenceBar value={barValue} height={9} ariaLabel={`${name} score`} variant="plate" />
        )}
        {raw != null && <span className={styles.rowRaw}>{raw}</span>}
      </span>
      <span id={capId} className={styles.caption} hidden={!open}>
        {caption}
      </span>
    </button>
  );
}
