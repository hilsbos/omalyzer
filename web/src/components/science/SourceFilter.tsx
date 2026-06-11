/* ── set-piece III · SOURCE → FILTER (section II) ────────────────────────────
   Two stacked panels, one frequency axis. TOP: a vocal-tract line silhouette
   (two-tube Fant approximation — the drawn cavity lengths COMPUTE the formant
   frequencies: F1 ≈ c/(4·L_back), F2 ≈ c/(4·L_front), c = 343 m/s). BOTTOM:
   a glottal buzz — harmonics at k·f0, f0 = 120 Hz fixed, |S_k| = 1/k²
   (−12 dB/oct) — shaped live by the tract's resonator product, drawn in dB so
   source × filter becomes an addition of envelopes.
   One deliberate 2.6 s morph on reveal (schwa → om /o/; only the FILTER
   moves) — the back cavity (F1) leads and the front cavity (F2) follows, per
   the storyboard's "(F1, then F2)" — then the piece rests. Reduced motion
   renders the settled frame. All per-frame drawing goes through refs — never
   React state. */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  blinkOpacity,
  clamp01,
  easeHouse,
  lerp,
  linToDb,
  resonatorMag,
  smootherstep,
  useInView,
  usePrefersReducedMotion,
  useRafLoop,
} from './motion';
import {
  CURSOR,
  GRATICULE,
  STROKE,
  SVG_LABEL_STYLE,
  SVG_READOUT_STYLE,
  TOKEN,
  VIEW,
} from './palette';
import marginalia from './marginalia.module.css';

/* ════════════════════════════ geometry ═════════════════════════════════ */

const W = VIEW.width; //                       611
const TRACT_H = VIEW.tractHeight; //           110 — top panel
const H = TRACT_H + 1 + VIEW.spectrumHeight; //261 — 1px seam between panels
const SEAM_Y = TRACT_H + 0.5;
const SPEC_TOP = TRACT_H + 1;

const PAD_L = 16;
const PAD_R = 16;
const PLOT_W = W - PAD_L - PAD_R;

const BASE_Y = H - 22; //          spectrum baseline (room beneath for labels)
const SPEC_PLOT_TOP = SPEC_TOP + 10;
const SPEC_PLOT_H = BASE_Y - SPEC_PLOT_TOP;
const LABEL_Y = BASE_Y + 14; //    the sliding F1/F2 readouts

/* ════════════════════════════ acoustics ════════════════════════════════ */

const C_SOUND = 343; //  m/s — speed of sound, the two-tube constant
const F0 = 120; //       Hz — source pitch, FIXED (only the filter moves)
const F_MAX = 2200; //   Hz at the right edge (F3's skirt only)
const F3 = 2500; //      Hz, held
const B3 = 250; //       Hz
const N_HARM = Math.floor(F_MAX / F0); // 18 harmonics
const ENV_SAMPLES = 160;

/* dB window of the spectrum panel (0 dB = first source harmonic) */
const MAX_DB = 6;
const MIN_DB = -54;

/* tract panel: glottis anchored left, lips extend right as the tract morphs */
const TRACT_CY = 58;
const GLOTTIS_X = PAD_L + 24;
const PX_PER_M = 1700; // ≈17 px/cm — /o/'s 31.7 cm tract fits the measure

/* morph endpoints — cavity LENGTHS are primary; frequencies are computed.
   schwa: F1 = 500, F2 = 1500 (uniform tube) → /o/: F1 = 420, F2 = 760. */
const LB_SCHWA = C_SOUND / (4 * 500);
const LB_O = C_SOUND / (4 * 420);
const LF_SCHWA = C_SOUND / (4 * 1500);
const LF_O = C_SOUND / (4 * 760);

interface Formants {
  F1: number;
  F2: number;
  B1: number;
  B2: number;
  LbPx: number;
  LfPx: number;
}

/** Geometry first: interpolate the cavity lengths, then F = c/(4L). The two
 *  cavities carry SEPARATE morph parameters — the back cavity (mB → F1)
 *  leads, the front cavity (mF → F2) follows — which keeps the two-tube math
 *  honest while restoring the storyboard's "two rising humps (F1, then F2)"
 *  sequencing. */
function formantsAt(mB: number, mF: number): Formants {
  const Lb = lerp(LB_SCHWA, LB_O, mB);
  const Lf = lerp(LF_SCHWA, LF_O, mF);
  return {
    F1: C_SOUND / (4 * Lb),
    F2: C_SOUND / (4 * Lf),
    B1: lerp(200, 60, mB), // wide/flat → tight
    B2: lerp(200, 90, mF),
    LbPx: Lb * PX_PER_M,
    LfPx: Lf * PX_PER_M,
  };
}

/** Glottal source envelope, dB re first harmonic: −12 dB/oct above f0. */
const sourceDb = (f: number): number => -12 * Math.log2(Math.max(f, F0) / F0);

/** Tract filter |H(f)| in dB — product of three 2-pole resonators. */
function filterDb(f: number, fm: Formants): number {
  return (
    linToDb(resonatorMag(f, fm.F1, fm.B1)) +
    linToDb(resonatorMag(f, fm.F2, fm.B2)) +
    linToDb(resonatorMag(f, F3, B3))
  );
}

/** Output |Y| = |S|·|H| in dB; `a` ramps the filter in at morph onset. */
const outputDb = (f: number, a: number, fm: Formants): number =>
  sourceDb(f) + a * filterDb(f, fm);

const xOf = (f: number): number => PAD_L + (f / F_MAX) * PLOT_W;
const yOfDb = (db: number): number =>
  BASE_Y - clamp01((db - MIN_DB) / (MAX_DB - MIN_DB)) * SPEC_PLOT_H;

/* ════════════════════════════ path builders ════════════════════════════ */

/** Tract walls: half-height profile over arc length, cosine-smoothed through
 *  five control points. The constriction sits exactly at the back/front-cavity
 *  junction — the geometry that moves the formants IS the pinch you see. Each
 *  wall feature follows its own cavity's morph clock (back = mB, front = mF). */
function tractWallPaths(mB: number, mF: number, fm: Formants): { top: string; bottom: string } {
  const Lpx = fm.LbPx + fm.LfPx;
  const ctrl: { d: number; h: number }[] = [
    { d: 0, h: 4 }, //                              glottis (narrow, fixed)
    { d: 0.5 * fm.LbPx, h: lerp(14, 18, mB) }, //   pharynx belly widens
    { d: fm.LbPx, h: lerp(14, 5.5, mB) }, //        the constriction forms
    { d: fm.LbPx + 0.55 * fm.LfPx, h: lerp(14, 12, mF) }, // mouth cavity
    { d: Lpx, h: lerp(12, 5, mF) }, //              lips round
  ];
  const halfAt = (d: number): number => {
    let i = 0;
    while (i < ctrl.length - 2 && d > ctrl[i + 1].d) i++;
    const a = ctrl[i];
    const b = ctrl[i + 1];
    const tau = clamp01((d - a.d) / (b.d - a.d));
    const s = (1 - Math.cos(Math.PI * tau)) / 2;
    return lerp(a.h, b.h, s);
  };
  const n = 72;
  let top = '';
  let bottom = '';
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * Lpx;
    const h = halfAt(d);
    const x = (GLOTTIS_X + d).toFixed(1);
    const cmd = i === 0 ? 'M' : 'L';
    top += `${cmd}${x} ${(TRACT_CY - h).toFixed(1)}`;
    bottom += `${cmd}${x} ${(TRACT_CY + h).toFixed(1)}`;
  }
  return { top, bottom };
}

/** Output envelope sampled over the axis, split at the F1–F2 valley so the
 *  F1 hump strokes terracotta and the F2 hump ochre — one line, two tints,
 *  a hard split (no gradients inside diagrams). */
function envelopePaths(a: number, fm: Formants): { low: string; mid: string } {
  const xs = new Array<number>(ENV_SAMPLES);
  const ys = new Array<number>(ENV_SAMPLES);
  const dbs = new Array<number>(ENV_SAMPLES);
  for (let i = 0; i < ENV_SAMPLES; i++) {
    const f = (i / (ENV_SAMPLES - 1)) * F_MAX;
    dbs[i] = outputDb(f, a, fm);
    xs[i] = xOf(f);
    ys[i] = yOfDb(dbs[i]);
  }
  const iAt = (f: number): number =>
    Math.max(0, Math.min(ENV_SAMPLES - 1, Math.round((f / F_MAX) * (ENV_SAMPLES - 1))));
  const i1 = iAt(fm.F1);
  const i2 = iAt(fm.F2);
  let split = i1;
  for (let i = i1; i <= i2; i++) if (dbs[i] < dbs[split]) split = i;
  const seg = (from: number, to: number): string => {
    let d = '';
    for (let i = from; i <= to; i++) {
      d += `${i === from ? 'M' : 'L'}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`;
    }
    return d;
  };
  return { low: seg(0, split), mid: seg(split, ENV_SAMPLES - 1) };
}

/** The dotted "no resonance yet" reference — the bare source tilt, static. */
const GHOST_D = (() => {
  let d = '';
  for (let i = 0; i < ENV_SAMPLES; i++) {
    const f = (i / (ENV_SAMPLES - 1)) * F_MAX;
    d += `${i === 0 ? 'M' : 'L'}${xOf(f).toFixed(1)} ${yOfDb(sourceDb(f)).toFixed(1)}`;
  }
  return d;
})();

/* ════════════════════════════ timeline ═════════════════════════════════ */

const CURSOR_IN_AT = 0.1; //  cursor drops in at left
const CURSOR_IN_DUR = 0.35;
const MORPH_AT = 0.55; //     the single beat (2.6s total: F1 leads, F2 follows)
const MORPH_DUR = 2.6;
const MORPH_B_DUR = 1.9; //   back cavity → F1, the leading hump
const MORPH_F_LAG = 0.7; //   front cavity → F2 starts 0.7s later…
const MORPH_F_DUR = MORPH_DUR - MORPH_F_LAG; // …and lands with the beat
const BLINK_AT = 3.35; //     one 0.6 s raised-cosine blink, then stills
const REST_AT = 4.0;

const GRID_STEP = W / GRATICULE.divisions;
const HARMONIC_XS = Array.from({ length: N_HARM }, (_, i) => xOf((i + 1) * F0));

/* ════════════════════════════ component ════════════════════════════════ */

export default function SourceFilter(props: { className?: string }) {
  const rootRef = useRef<SVGSVGElement>(null);
  const tractTopRef = useRef<SVGPathElement>(null);
  const tractBottomRef = useRef<SVGPathElement>(null);
  const envLowRef = useRef<SVGPathElement>(null);
  const envMidRef = useRef<SVGPathElement>(null);
  const ghostRef = useRef<SVGPathElement>(null);
  const harmRefs = useRef<(SVGLineElement | null)[]>([]);
  const f1GroupRef = useRef<SVGGElement>(null);
  const f2GroupRef = useRef<SVGGElement>(null);
  const f1TextRef = useRef<SVGTextElement>(null);
  const f2TextRef = useRef<SVGTextElement>(null);
  const f1BelowRef = useRef<HTMLSpanElement>(null);
  const f2BelowRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<SVGGElement>(null);

  const reduced = usePrefersReducedMotion();
  const armed = useInView(rootRef, { once: true }); // the beat trigger
  const [done, setDone] = useState(false);

  /** Paint one composed frame. mB / mF = the two cavity morphs (0 schwa →
   *  1 /o/; back leads, front follows); cursorDrop = drop-in progress;
   *  cursorOpacity = final cursor alpha. */
  const renderFrame = useCallback(
    (mB: number, mF: number, cursorDrop: number, cursorOpacity: number) => {
      const fm = formantsAt(mB, mF);
      const a = smootherstep(0, 0.25, mB); // the filter engages as the tract takes shape

      const walls = tractWallPaths(mB, mF, fm);
      tractTopRef.current?.setAttribute('d', walls.top);
      tractBottomRef.current?.setAttribute('d', walls.bottom);

      const env = envelopePaths(a, fm);
      const envOpacity = smootherstep(0.02, 0.3, mB).toFixed(3);
      envLowRef.current?.setAttribute('d', env.low);
      envLowRef.current?.setAttribute('opacity', envOpacity);
      envMidRef.current?.setAttribute('d', env.mid);
      envMidRef.current?.setAttribute('opacity', envOpacity);

      ghostRef.current?.setAttribute(
        'opacity',
        (0.7 * (1 - smootherstep(0, 0.35, mB))).toFixed(3),
      );

      // output = source × filter, recomputed live at every harmonic
      for (let k = 1; k <= N_HARM; k++) {
        harmRefs.current[k - 1]?.setAttribute(
          'y2',
          yOfDb(outputDb(k * F0, a, fm)).toFixed(1),
        );
      }

      // the two sliding labels — TRUE computed Hz, nothing faked; each fades
      // in on its own cavity's clock (F1 first, then F2)
      const f1Opacity = (0.9 * smootherstep(0.05, 0.35, mB)).toFixed(3);
      const f2Opacity = (0.9 * smootherstep(0.05, 0.35, mF)).toFixed(3);
      f1GroupRef.current?.setAttribute('transform', `translate(${xOf(fm.F1).toFixed(1)} 0)`);
      f1GroupRef.current?.setAttribute('opacity', f1Opacity);
      f2GroupRef.current?.setAttribute('transform', `translate(${xOf(fm.F2).toFixed(1)} 0)`);
      f2GroupRef.current?.setAttribute('opacity', f2Opacity);
      const f1Text = `F1 · ${Math.round(fm.F1)} Hz`;
      const f2Text = `F2 · ${Math.round(fm.F2)} Hz`;
      if (f1TextRef.current) f1TextRef.current.textContent = f1Text;
      if (f2TextRef.current) f2TextRef.current.textContent = f2Text;
      if (f1BelowRef.current) f1BelowRef.current.textContent = f1Text;
      if (f2BelowRef.current) f2BelowRef.current.textContent = f2Text;

      cursorRef.current?.setAttribute(
        'transform',
        `translate(0 ${(-10 * (1 - cursorDrop)).toFixed(1)})`,
      );
      cursorRef.current?.setAttribute('opacity', cursorOpacity.toFixed(3));
    },
    [],
  );

  // The one beat. t is active-animation seconds; pauses off-screen for free.
  useRafLoop(
    rootRef,
    (t) => {
      const drop = easeHouse(clamp01((t - CURSOR_IN_AT) / CURSOR_IN_DUR));
      const mB = smootherstep(0, 1, (t - MORPH_AT) / MORPH_B_DUR);
      const mF = smootherstep(0, 1, (t - MORPH_AT - MORPH_F_LAG) / MORPH_F_DUR);
      const cursor = drop * blinkOpacity(t, BLINK_AT); // the shared idiom
      renderFrame(mB, mF, drop, cursor);
      if (t >= REST_AT) setDone(true); // rest — the loop stops, the vowel holds
    },
    { enabled: armed && !reduced && !done },
  );

  // Static frames: pre-beat rest (m = 0) before arming; the composed final
  // frame (m = 1) under reduced motion or once the beat has rested.
  useLayoutEffect(() => {
    if (reduced || done) renderFrame(1, 1, 1, 1);
    else if (!armed) renderFrame(0, 0, 0, 0);
  }, [reduced, done, armed, renderFrame]);

  return (
    <div className={[marginalia.figure, props.className].filter(Boolean).join(' ')}>
    <svg
      ref={rootRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Source and filter: a vocal-tract silhouette morphs from a neutral shape into the om vowel, and its computed resonances shape a flat harmonic buzz into a vowel spectrum with formant peaks F1 near 420 hertz and F2 near 760 hertz."
    >
      {/* graticule — the observatory's grid, verticals only */}
      {Array.from({ length: GRATICULE.divisions - 1 }, (_, i) => (
        <line
          key={`g${i}`}
          x1={(i + 1) * GRID_STEP}
          y1={0}
          x2={(i + 1) * GRID_STEP}
          y2={H}
          stroke={TOKEN.rule}
          strokeWidth={STROKE.hair}
          opacity={GRATICULE.opacityLight}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* channel label (left rail) — matches the hero's x=10/y=18 register */}
      <text x={10} y={18} fill={TOKEN.accentSoft} style={SVG_LABEL_STYLE} className={marginalia.svgOnly}>
        ch3 · source → filter
      </text>

      {/* ── top panel: the tract (the filter) ── */}
      <line
        x1={GLOTTIS_X}
        y1={TRACT_CY - 4}
        x2={GLOTTIS_X}
        y2={TRACT_CY + 4}
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        vectorEffect="non-scaling-stroke"
      />
      <path
        ref={tractTopRef}
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        strokeLinecap="butt"
        vectorEffect="non-scaling-stroke"
      />
      <path
        ref={tractBottomRef}
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        strokeLinecap="butt"
        vectorEffect="non-scaling-stroke"
      />

      {/* seam between panels */}
      <line
        x1={0}
        y1={SEAM_Y}
        x2={W}
        y2={SEAM_Y}
        stroke={TOKEN.rule}
        strokeWidth={STROKE.hair}
        vectorEffect="non-scaling-stroke"
      />

      {/* ── bottom panel: the spectrum (source × filter, in dB) ── */}
      {/* harmonic comb at k·f0 — x positions never move: f0 is fixed */}
      {HARMONIC_XS.map((x, i) => (
        <line
          key={`h${i}`}
          ref={(el) => {
            harmRefs.current[i] = el;
          }}
          x1={x}
          y1={BASE_Y}
          x2={x}
          y2={BASE_Y}
          stroke={TOKEN.accentSoft}
          strokeWidth={STROKE.hair}
          strokeLinecap="butt"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* dotted source-only reference — "no resonance yet" */}
      <path
        ref={ghostRef}
        d={GHOST_D}
        fill="none"
        stroke={TOKEN.accentSoft}
        strokeWidth={STROKE.hair}
        strokeDasharray="2 4"
        opacity={0.7}
        vectorEffect="non-scaling-stroke"
      />

      {/* the rising formant envelope — F1 hump terracotta, F2 hump ochre */}
      <path
        ref={envLowRef}
        fill="none"
        stroke={TOKEN.dataLow}
        strokeWidth={STROKE.line}
        strokeLinecap="butt"
        opacity={0}
        vectorEffect="non-scaling-stroke"
      />
      <path
        ref={envMidRef}
        fill="none"
        stroke={TOKEN.dataMid}
        strokeWidth={STROKE.line}
        strokeLinecap="butt"
        opacity={0}
        vectorEffect="non-scaling-stroke"
      />

      {/* baseline — the only axis chrome */}
      <line
        x1={PAD_L}
        y1={BASE_Y}
        x2={W - PAD_R}
        y2={BASE_Y}
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        vectorEffect="non-scaling-stroke"
      />

      {/* sliding F1 / F2 labels — live computed Hz. The text itself is ink
          (terracotta/ochre at ~11px on the page's parchment #FAF7F1 ground
          fail AA at ~2.5–4.2:1); each hump keeps its color through the short
          tick that pins the label to its formant. */}
      <g ref={f1GroupRef} opacity={0}>
        <line
          x1={0}
          x2={0}
          y1={BASE_Y + 2}
          y2={BASE_Y + 6}
          stroke={TOKEN.dataLow}
          strokeWidth={STROKE.line}
          vectorEffect="non-scaling-stroke"
        />
        <text
          ref={f1TextRef}
          x={0}
          y={LABEL_Y}
          textAnchor="middle"
          fill={TOKEN.inkSoft}
          style={SVG_READOUT_STYLE}
          className={marginalia.svgOnly}
        />
      </g>
      <g ref={f2GroupRef} opacity={0}>
        <line
          x1={0}
          x2={0}
          y1={BASE_Y + 2}
          y2={BASE_Y + 6}
          stroke={TOKEN.dataMid}
          strokeWidth={STROKE.line}
          vectorEffect="non-scaling-stroke"
        />
        <text
          ref={f2TextRef}
          x={0}
          y={LABEL_Y}
          textAnchor="middle"
          fill={TOKEN.inkSoft}
          style={SVG_READOUT_STYLE}
          className={marginalia.svgOnly}
        />
      </g>

      {/* the shared cursor idiom — drops in at left, parks, one blink, stills */}
      <g ref={cursorRef} opacity={0}>
        <line
          x1={PAD_L}
          y1={SPEC_TOP + 8}
          x2={PAD_L}
          y2={BASE_Y}
          stroke={TOKEN.accent}
          strokeWidth={STROKE.hair}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={PAD_L - CURSOR.cross}
          y1={(SPEC_TOP + 8 + BASE_Y) / 2}
          x2={PAD_L + CURSOR.cross}
          y2={(SPEC_TOP + 8 + BASE_Y) / 2}
          stroke={TOKEN.accent}
          strokeWidth={STROKE.hair}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>

    {/* mobile marginalia — channel label + live F1/F2 readouts inline-below
        (the in-SVG sliding labels are ~6px at phone widths); the colored
        ticks still ride the formants in the diagram */}
    <div className={marginalia.below} aria-hidden="true">
      <span>ch3 · source → filter</span>
      <span ref={f1BelowRef} className={marginalia.num} />
      <span ref={f2BelowRef} className={marginalia.num} />
    </div>
    </div>
  );
}
