/**
 * A 0..1 horizontal bar, red (low) -> amber -> green (high). The fill color rule
 * is ported verbatim from crates/desktop/src/ui.rs coherence_bar so the web bar
 * reads identically to the desktop one. `value == null` shows only the track.
 */
export interface CoherenceBarProps {
  value: number | null | undefined;
  /** Height in px (width is 100% of the container). */
  height?: number;
  ariaLabel?: string;
}

function fillColor(t: number): string {
  const v = Math.min(Math.max(t, 0), 1);
  if (v < 0.5) {
    const k = Math.min(Math.max(v / 0.5, 0), 1);
    return `rgb(220, ${(90 + 120 * k) | 0}, 70)`;
  }
  const k = Math.min(Math.max((v - 0.5) / 0.5, 0), 1);
  return `rgb(${(220 - 100 * k) | 0}, 210, ${(70 + 50 * k) | 0})`;
}

export default function CoherenceBar({ value, height = 12, ariaLabel }: CoherenceBarProps) {
  const v = value == null || !Number.isFinite(value) ? null : Math.min(Math.max(value, 0), 1);
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={v ?? undefined}
      aria-label={ariaLabel}
      style={{
        flex: 1,
        height,
        minWidth: 80,
        borderRadius: 3,
        background: 'rgb(30,30,30)',
        border: '1px solid rgb(60,60,60)',
        overflow: 'hidden',
      }}
    >
      {v != null && (
        <div
          style={{
            width: `${v * 100}%`,
            height: '100%',
            background: fillColor(v),
            borderRadius: 2,
          }}
        />
      )}
    </div>
  );
}
