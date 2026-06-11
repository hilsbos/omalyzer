/* ── Set-piece IV · THE FIVE DIMENSIONS — five traces braiding into one ─────
   Section III, between the <ol> of five metrics and the harmonic-mean callout.
   One 3.4s beat on reveal: five sub-metric scope channels settle (each with its
   own time constant), bend rightward, braid into a single strand, and feed the
   Index meter while the big number counts up — the live weighted HARMONIC mean.
   At t≈2.4s the harmonic trace (weight .30) dips −0.45 for 0.4s: the Index
   drops hard while a dashed arithmetic-mean ghost barely moves — the equation
   does the storytelling. Then it rests. All numbers are TRUE computed values.
   Reduced motion: the composed final frame (settled strands, complete braid,
   final Index, static ghost reference). Deterministic noise only — no
   Math.random. rAF auto-pauses off-screen via useRafLoop. */

import { useEffect, useRef, useState } from 'react';
import {
  blinkOpacity,
  useInView,
  useRafLoop,
  usePrefersReducedMotion,
  makeNoise,
  smoothstep,
  clamp01,
  lerp,
  weightedHarmonicMean,
  weightedArithmeticMean,
} from './motion';
import { makeBraid } from '../braid';
import {
  TOKEN,
  STROKE,
  CURSOR,
  GRATICULE,
  VIEW,
  FIVE_DIMENSIONS,
  EASE_CSS,
  SVG_LABEL_STYLE,
  SVG_READOUT_STYLE,
} from './palette';
import marginalia from './marginalia.module.css';

/* ════════════════════════════ geometry ═════════════════════════════════ */

const W = VIEW.width; //          611
const H = VIEW.braidHeight; //    260

const X0 = 100; //                traces start (label column ends at 92)
const X_CONV0 = 400; //           lanes end / convergence begins
const X_CONV1 = 470; //           braid point — five become one
const X_METER = 506; //           meter track left edge
const METER_W = 90; //            meter track width
const METER_Y = 116; //           meter track top (8 tall, centered on 120)
const BRAID_Y = 120; //           the single strand's centerline

const LANE_Y = [40, 80, 120, 160, 200] as const; // lane centerlines
const LANE_AMP = 30; //           m∈[0,1] → ±15px about the lane centerline

/* ════════════════════════════ timeline (s) ═════════════════════════════ */

const BEAT = 3.4; //              the five traces sweep X0 → X_CONV1
const STRAND_END = 3.7; //        braid strand extends X_CONV1 → X_METER
const BLINK_AT = 3.9; //          cursor's single 0.6s raised-cosine blink, then stills
const DONE = 4.5;

const DIP_T = 2.4; //             the harmonic transient (the point-maker)
const DIP_DUR = 0.4;
const DIP_DEPTH = 0.45;

/* ════════════════════════════ the honest math ══════════════════════════ */

const WEIGHTS = FIVE_DIMENSIONS.map((d) => d.weight); // [.25,.15,.30,.15,.15]
const TARGETS = [0.92, 0.85, 0.88, 0.8, 0.9]; //  m*
const STARTS = [0.45, 0.5, 0.35, 0.55, 0.5]; //   m0
const TAUS = [0.6, 0.5, 0.9, 0.7, 0.55]; //       settle time constants (s)
const RIPPLE = 0.06; //                           ρ

/** ξ_i — five distinct deterministic incommensurate-sine pseudo-noises. */
const NOISES = TAUS.map((_, i) =>
  makeNoise([2.9 + 1.7 * i, 6.7 + 2.3 * i, 12.1 + 3.1 * i]),
);

/** The scripted −0.45 transient on the harmonic channel, raised-cosine. */
function dipAt(s: number): number {
  if (s < DIP_T || s > DIP_T + DIP_DUR) return 0;
  const u = Math.sin((Math.PI * (s - DIP_T)) / DIP_DUR);
  return -DIP_DEPTH * u * u;
}

/* The strand kinematics are the SHARED braid (components/braid.ts) — the same
   makeBraid the console's ScoreReveal drives with real measured sub-metrics;
   here it gets the scripted targets and the pedagogical harmonic dip. Same
   gesture, different inputs — provably, by import. */
const BRAID = makeBraid({
  laneY: LANE_Y,
  laneAmp: LANE_AMP,
  x0: X0,
  xConv0: X_CONV0,
  xConv1: X_CONV1,
  braidY: BRAID_Y,
  beat: BEAT,
  targets: TARGETS,
  starts: STARTS,
  taus: TAUS,
  ripple: RIPPLE,
  noises: NOISES,
  dip: (i, s) => (i === 2 ? dipAt(s) : 0),
});

function metricsAt(s: number): number[] {
  return TAUS.map((_, i) => BRAID.metric(i, s, false));
}

/* Final settled values — the parked Index and its near-coincident ghost. */
const I_FINAL = weightedHarmonicMean(TARGETS, WEIGHTS); //  ≈ 0.87
const A_FINAL = weightedArithmeticMean(TARGETS, WEIGHTS); // ≈ 0.88

/** The x-axis IS time: s∈[0, BEAT] sweeps X0 → X_CONV1. */
const xOf = BRAID.xOf;
const strandPath = BRAID.strandPath;

const BRAID_FULL = `M${X_CONV1} ${BRAID_Y} L${X_METER} ${BRAID_Y}`;

/* ════════════════════════════ component ════════════════════════════════ */

const N = FIVE_DIMENSIONS.length;
const GRID_STEP = W / GRATICULE.divisions;
const fmtWeight = (w: number): string => `.${String(Math.round(w * 100)).padStart(2, '0')}`;

export default function FiveDimensions({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const strandRefs = useRef<(SVGPathElement | null)[]>([]);
  const braidRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGRectElement>(null);
  const ghostRef = useRef<SVGLineElement>(null);
  const cursorRef = useRef<SVGGElement>(null);
  const readoutRef = useRef<SVGTextElement>(null);
  const readoutBelowRef = useRef<HTMLSpanElement>(null);

  const reduced = usePrefersReducedMotion();
  const armed = useInView(svgRef, { once: true }); // the beat trigger
  const [phase, setPhase] = useState<'idle' | 'play' | 'rest'>('idle');

  useEffect(() => {
    if (armed && !reduced && phase === 'idle') setPhase('play');
  }, [armed, reduced, phase]);

  useRafLoop(
    svgRef,
    (t) => {
      const s = Math.min(t, DONE);

      // Five scope channels, redrawn from 0 (deterministic — same s, same ink).
      for (let i = 0; i < N; i++) {
        strandRefs.current[i]?.setAttribute('d', strandPath(i, s, false));
      }

      // The single braided strand extends to the meter after the beat.
      const headX =
        s <= BEAT
          ? X_CONV1
          : lerp(X_CONV1, X_METER, clamp01((s - BEAT) / (STRAND_END - BEAT)));
      braidRef.current?.setAttribute(
        'd',
        s > BEAT ? `M${X_CONV1} ${BRAID_Y} L${headX.toFixed(2)} ${BRAID_Y}` : '',
      );

      // The Index — live weighted harmonic mean — and its arithmetic ghost.
      const vals = metricsAt(s);
      const index = weightedHarmonicMean(vals, WEIGHTS);
      const ghost = weightedArithmeticMean(vals, WEIGHTS);
      fillRef.current?.setAttribute('width', (METER_W * index).toFixed(2));
      const indexText = index.toFixed(2);
      if (readoutRef.current) readoutRef.current.textContent = indexText;
      if (readoutBelowRef.current) readoutBelowRef.current.textContent = indexText;

      // Ghost visible for the dip beat only.
      const gx = (X_METER + METER_W * ghost).toFixed(2);
      const gOp = smoothstep(DIP_T - 0.15, DIP_T, s) * (1 - smoothstep(2.9, 3.2, s));
      const g = ghostRef.current;
      if (g) {
        g.setAttribute('x1', gx);
        g.setAttribute('x2', gx);
        g.setAttribute('opacity', (0.8 * gOp).toFixed(3));
      }

      // The crosshair cursor: sweeps with the head, parks, one blink, stills.
      const cx = Math.min(s <= BEAT ? xOf(s) : headX, X_METER - 4);
      const cOp = blinkOpacity(s, BLINK_AT); // the shared idiom
      const c = cursorRef.current;
      if (c) {
        c.setAttribute('transform', `translate(${cx.toFixed(2)} 0)`);
        c.setAttribute('opacity', cOp.toFixed(3));
      }

      if (t >= DONE) setPhase('rest'); // loop disables; the record stays.
    },
    { enabled: phase === 'play' },
  );

  /* Composed final frame for reduced motion: strands at their settled values,
     braid complete, Index parked, the arithmetic ghost as a static faint
     reference beside the harmonic-mean value. Otherwise: idle/empty (refs own
     every frame after that). */
  const fin = reduced
    ? {
        strands: FIVE_DIMENSIONS.map((_, i) => strandPath(i, BEAT, true)),
        braid: BRAID_FULL,
        meterW: METER_W * I_FINAL,
        readout: I_FINAL.toFixed(2),
        ghostX: X_METER + METER_W * A_FINAL,
        ghostOpacity: 0.8,
        cursor: `translate(${X_METER - 4} 0)`,
        cursorOpacity: 1,
      }
    : {
        strands: FIVE_DIMENSIONS.map(() => ''),
        braid: '',
        meterW: 0,
        readout: '—',
        ghostX: X_METER + METER_W * A_FINAL,
        ghostOpacity: 0,
        cursor: 'translate(0 0)',
        cursorOpacity: 0,
      };

  /* "Dim to captions" once the beat rests — floored at 0.85 so the ~11px
     labels hold AA on the page's parchment #FAF7F1 ground (ink-soft at 0.85
     ≈ 6:1; below ~0.75 it slips under 4.5:1). Never dimmed under reduced
     motion: that would be a permanent sub-state, not a rest. */
  const dimmed = !reduced && phase === 'rest';

  return (
    <div className={[marginalia.figure, className].filter(Boolean).join(' ')}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Five sub-metric traces — pitch, amplitude, harmonic, spectral, resonance — settle, braid into a single strand, and feed the Coherence Index meter; a brief harmonic dip drags the Index down far more than an arithmetic average would move."
    >
      {/* graticule — full-bleed y 0→H, the one register all four panels share */}
      <g stroke={TOKEN.rule} strokeWidth={STROKE.hair} opacity={GRATICULE.opacityLight}>
        {Array.from({ length: GRATICULE.divisions - 1 }, (_, k) => (
          <line
            key={k}
            x1={(k + 1) * GRID_STEP}
            x2={(k + 1) * GRID_STEP}
            y1={0}
            y2={H}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {/* channel label (left rail) — the observatory's fourth panel */}
      <text x={10} y={18} fill={TOKEN.accentSoft} style={SVG_LABEL_STYLE} className={marginalia.svgOnly}>
        ch4 · five dimensions
      </text>

      {/* the five lane rails */}
      <g stroke={TOKEN.rule} strokeWidth={STROKE.hair} opacity={0.55}>
        {LANE_Y.map((y) => (
          <line key={y} x1={X0} x2={X_CONV0} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* lane labels + weights — ink-soft (accent-soft / fg-weak fail AA at
          ~11px on this ground), dimming to captions once the beat rests */}
      <g
        className={marginalia.svgOnly}
        style={{ opacity: dimmed ? 0.85 : 1, transition: `opacity 600ms ${EASE_CSS}` }}
      >
        {FIVE_DIMENSIONS.map((d, i) => (
          <g key={d.key}>
            <text x={8} y={LANE_Y[i] + 4} style={SVG_LABEL_STYLE} fill={TOKEN.inkSoft}>
              {d.label}
            </text>
            <text
              x={92}
              y={LANE_Y[i] + 4}
              textAnchor="end"
              style={SVG_READOUT_STYLE}
              fill={TOKEN.inkSoft}
            >
              {fmtWeight(d.weight)}
            </text>
          </g>
        ))}
      </g>

      {/* the five strands */}
      {FIVE_DIMENSIONS.map((d, i) => (
        <path
          key={d.key}
          ref={(el) => {
            strandRefs.current[i] = el;
          }}
          d={fin.strands[i]}
          fill="none"
          stroke={d.color}
          strokeWidth={STROKE.trace}
          strokeLinejoin="bevel"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* the single braided strand feeding the meter */}
      <path
        ref={braidRef}
        d={fin.braid}
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.braid}
        vectorEffect="non-scaling-stroke"
      />

      {/* the Index meter — track, live fill, big tabular readout.
          Documented deviation (owner-visible, like the other AA notes): the
          --data-track-paper track fill (#E6DECE) sits barely off the page's
          parchment #FAF7F1 ground, so a bare track hardly reads — the REST
          state's "single empty meter" all but vanishes, and the live fill +
          arithmetic ghost float without a full-scale extent. A 1px --rule
          hairline outline restores the meter's extent in the house idiom
          (thin ink line, no second surface). */}
      <rect
        x={X_METER}
        y={METER_Y}
        width={METER_W}
        height={8}
        fill={TOKEN.dataTrack}
        stroke={TOKEN.rule}
        strokeWidth={STROKE.hair}
        vectorEffect="non-scaling-stroke"
      />
      <rect ref={fillRef} x={X_METER} y={METER_Y} width={fin.meterW} height={8} fill={TOKEN.dataHigh} />
      <text
        ref={readoutRef}
        x={X_METER + METER_W}
        y={100}
        textAnchor="end"
        style={{ ...SVG_READOUT_STYLE, fontSize: 22 }}
        fill={TOKEN.ink}
        className={marginalia.svgOnly}
      >
        {fin.readout}
      </text>
      <text x={X_METER} y={146} style={SVG_LABEL_STYLE} fill={TOKEN.accentSoft} className={marginalia.svgOnly}>
        coherence index
      </text>

      {/* the arithmetic-mean ghost — where a plain average would have sat */}
      <line
        ref={ghostRef}
        x1={fin.ghostX}
        x2={fin.ghostX}
        y1={METER_Y - 6}
        y2={METER_Y + 14}
        stroke={TOKEN.inkWeak}
        strokeWidth={0.75}
        strokeDasharray="2 2"
        opacity={fin.ghostOpacity}
        vectorEffect="non-scaling-stroke"
      />

      {/* the crosshair cursor — sweeps, parks, one 0.6s blink, stills */}
      <g
        ref={cursorRef}
        transform={fin.cursor}
        opacity={fin.cursorOpacity}
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
      >
        <line x1={0} x2={0} y1={28} y2={H - 48} vectorEffect="non-scaling-stroke" />
        <line x1={-CURSOR.cross} x2={CURSOR.cross} y1={BRAID_Y} y2={BRAID_Y} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>

    {/* mobile marginalia — lane legend (stroke-colored swatches map the
        strands), weights, and the live Index, inline-below (graft law) */}
    <div className={marginalia.below} aria-hidden="true">
      {FIVE_DIMENSIONS.map((d) => (
        <span key={d.key} className={marginalia.item}>
          <i className={marginalia.swatch} style={{ background: d.color }} />
          {d.label} {fmtWeight(d.weight)}
        </span>
      ))}
      <span className={marginalia.item}>
        coherence index{' '}
        <span ref={readoutBelowRef} className={marginalia.num}>
          {fin.readout}
        </span>
      </span>
    </div>
    </div>
  );
}
