/* ── /science set-piece palette — one hand draws all four diagrams ──────────
   TOKEN.* are CSS var() strings. USE THESE in SVG attributes whenever
   possible: they resolve through the cascade, so the diagrams stay in step
   with the site tokens with zero edits. Source of truth:
   web/src/styles/tokens.css. Do not invent colors. (Only tokens actually
   consumed by the set-pieces live here.) */

/** Cascade-resolving color strings — preferred for all SVG strokes/fills. */
export const TOKEN = {
  ink: 'var(--ink)',
  inkSoft: 'var(--ink-soft)',
  inkWeak: 'var(--fg-weak)',
  rule: 'var(--rule)',
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
  dataLow: 'var(--data-low)',
  dataMid: 'var(--data-mid)',
  dataHigh: 'var(--data-high)',
  dataTrack: 'var(--data-track-paper)',
} as const;

/** Stroke-width law (px, with vector-effect: non-scaling-stroke). */
export const STROKE = {
  hair: 1, //    graticule, axes, anatomy outlines, ticks, ghost combs
  trace: 1.25, // the five sub-metric strands (set-piece IV)
  line: 1.5, //  THE line: hero waveform, vagus, formant envelope
  braid: 1.75, // the braided single strand feeding the Index meter
} as const;

/** The measurement cursor — one repeated gesture (vertical + crossbar) that
 *  stitches the four panels into one instrument. `cross` is the crossbar's
 *  half-length in viewBox units; every panel draws it x ∈ [−cross, +cross]. */
export const CURSOR = { cross: 5 } as const;

/** Halo/ghost stroke for the hero's unresolved noise (3× offset copies). */
export const HALO = { width: 0.5, opacity: 0.28, offsetPx: 2 } as const;

/** Graticule: 1px verticals every 1/8 width; ghosted. One register, all four
 *  panels: full-bleed y = 0 → H — the device that makes the diagrams read as
 *  panels of ONE oscilloscope. */
export const GRATICULE = {
  divisions: 8,
  opacityLight: 0.18, // TOKEN.rule verticals on paper grounds
} as const;

/** Shared viewBox geometry — all set-pieces draw in a 611-unit-wide box. */
export const VIEW = {
  width: 611,
  heroHeight: 236, //   set-piece 1 (φ⁻² of width)
  bridgeHeight: 190, // set-piece 2
  tractHeight: 110, //  set-piece 3, top panel
  spectrumHeight: 150, // set-piece 3, bottom panel (1px seam between panels)
  braidHeight: 260, //  set-piece 4
} as const;

/** The five sub-metrics: label, VCI weight, lane stroke color (set-piece IV). */
export const FIVE_DIMENSIONS = [
  { key: 'pitch', label: 'pitch', weight: 0.25, color: TOKEN.dataMid },
  { key: 'amplitude', label: 'amplitude', weight: 0.15, color: TOKEN.accentSoft },
  { key: 'harmonic', label: 'harmonic', weight: 0.3, color: TOKEN.dataHigh },
  { key: 'spectral', label: 'spectral', weight: 0.15, color: TOKEN.accent },
  { key: 'resonance', label: 'resonance', weight: 0.15, color: TOKEN.dataLow },
] as const;

/** House easing as a CSS string (matches Reveal/OmLockup). */
export const EASE_CSS = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Small-caps channel-label text style for SVG <text> (spread onto props). */
export const SVG_LABEL_STYLE = {
  fontFamily: 'var(--mono)',
  fontSize: 11, // viewBox units ≈ --t-label at full measure width
  fontWeight: 500,
  letterSpacing: '0.146em',
  fontVariantCaps: 'all-small-caps',
} as const;

/** Tabular live-readout text style for SVG <text> (true computed numbers only). */
export const SVG_READOUT_STYLE = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 400,
  fontVariantNumeric: 'tabular-nums lining-nums',
} as const;
