/**
 * A 0..1 horizontal bar that reads red(low) → ochre → green(high). The same
 * component renders on two grounds, so it branches on `variant`: on a dark
 * instrument plate (Hero dial, CoherencePanel) the saturated terracotta→ochre→sage
 * ramp is justified; directly on parchment (InfoRow inline) a muted variant is used.
 * `value == null` shows only the track. `role="meter"` is preserved.
 */
export interface CoherenceBarProps {
  value: number | null | undefined;
  /** Height in px (width is 100% of the container). */
  height?: number;
  ariaLabel?: string;
  /** Which ground the bar sits on. Defaults to the dark instrument plate. */
  variant?: 'plate' | 'paper';
}

/** Linear interpolation between two #rrggbb hex colors, t in [0,1]. */
function lerpHex(a: string, b: string, t: number): string {
  const k = Math.min(Math.max(t, 0), 1);
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const r = (pa[0] + (pb[0] - pa[0]) * k) | 0;
  const g = (pa[1] + (pb[1] - pa[1]) * k) | 0;
  const bl = (pa[2] + (pb[2] - pa[2]) * k) | 0;
  return `rgb(${r}, ${g}, ${bl})`;
}

// On the dark instrument plate: brighter terracotta → ochre → sage.
function fillColorPlate(v: number): string {
  if (v < 0.5) return lerpHex('#D9764E', '#E3B652', v / 0.5);
  return lerpHex('#E3B652', '#7FA86E', (v - 0.5) / 0.5);
}
// Directly on parchment: muted terracotta → ochre → sage.
function fillColorPaper(v: number): string {
  if (v < 0.5) return lerpHex('#B2603F', '#C39A3C', v / 0.5);
  return lerpHex('#C39A3C', '#5E7E55', (v - 0.5) / 0.5);
}

export default function CoherenceBar({
  value,
  height = 12,
  ariaLabel,
  variant = 'plate',
}: CoherenceBarProps) {
  const v = value == null || !Number.isFinite(value) ? null : Math.min(Math.max(value, 0), 1);
  const onPlate = variant !== 'paper';
  const fillColor = onPlate ? fillColorPlate : fillColorPaper;
  const track = onPlate ? '#232838' : '#E6DECE';
  const border = onPlate ? '#2E3650' : 'var(--rule)';
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
        minWidth: 0,
        borderRadius: 0,
        background: track,
        border: `1px solid ${border}`,
        overflow: 'hidden',
      }}
    >
      {v != null && (
        <div
          style={{
            width: `${v * 100}%`,
            height: '100%',
            background: fillColor(v),
            borderRadius: 0,
          }}
        />
      )}
    </div>
  );
}
