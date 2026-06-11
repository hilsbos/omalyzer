/* ── ScoreReveal — "the braid reckoning" — the console's capture ceremony ───
   The FiveDimensions motif transposed to the dark plate and driven by a REAL
   completed tone: the five measured sub-metrics settle from a derived spread,
   converge, weave the 1¼-turn braid, become one strand, and feed the meter
   while the index counts up via the true weighted harmonic mean of THOSE
   values — then the text SNAPS to the Rust core's `last_coherence_index`,
   which is always the number of record (the JS mean only drives the
   animation; f32-vs-f64 last-digit drift can never reach the screen).

   No dip, no arithmetic ghost — those are science-page pedagogy; a scripted
   transient on a real measurement would be a lie. No overlay, no dismissal:
   the parent composes this inside the captured-om band and remounts it with
   key={lastOm.capturedAt} so every capture gets a fresh t=0 beat.

   Timeline (full / first capture of a session):
     0–2.3 s  the five strands sweep left→right (x IS time) and settle
     2.3–2.6  the single braided strand extends into the meter; readout
              counts up; at settle it snaps to the core's index
     2.6–3.2  one 0.6 s raised-cosine cursor blink, then stillness → onDone
   Compressed (repeat captures, compressed={true}): the same gesture at
   9/16 time — DONE at 1.8 s, taus scaled to match.

   Reduced motion: the composed final frame, instantly — settled strands at
   the real targets, full braid, parked cursor, meter filled, the core's
   index and the caption printed; useRafLoop never ticks; onDone fires at
   once. Deterministic noise only (makeNoise) — no Math.random. Console
   plate tokens only — the science page's paper TOKEN.* never enters. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blinkOpacity,
  clamp,
  clamp01,
  lerp,
  makeNoise,
  useRafLoop,
  usePrefersReducedMotion,
  weightedHarmonicMean,
} from './science/motion';
import { STROKE, CURSOR, SVG_LABEL_STYLE, SVG_READOUT_STYLE } from './science/palette';
import { makeBraid, FIVE_DIMENSIONS_BASE } from './braid';
/* The meter-fill ramp is CoherenceBar's own (#D9764E→#E3B652→#7FA86E) — the
   revealed meter and the panel bars are the same instrument by import. */
import { fillColorPlate } from './CoherenceBar';
import styles from './ScoreReveal.module.css';

/* ════════════════════════════ props ════════════════════════════════════ */

/** The five measured sub-metrics, in CoherencePanel/weight order. Each may be
 *  null (TS-honest mirror of the Snapshot type): a null lane draws as a flat
 *  dimmed centerline and is excluded from the animated mean — the snapped
 *  final number stays correct regardless. */
export interface ScoreRevealMetrics {
  /** snapshot.pitch_coherence — weight .25 */
  pitch: number | null;
  /** snapshot.amplitude_coherence — weight .15 */
  amplitude: number | null;
  /** snapshot.harmonic_coherence — weight .30 */
  harmonic: number | null;
  /** snapshot.spectral_stability — weight .15 */
  spectral: number | null;
  /** snapshot.resonance_match — weight .15 */
  resonance: number | null;
}

export interface ScoreRevealProps {
  /** The latched capture's sub-metrics (lastOm.snapshot.*). */
  metrics: ScoreRevealMetrics;
  /** snapshot.last_coherence_index — THE number. The readout snaps to this;
   *  it is never recomputed, never clamped for display. */
  index: number;
  /** snapshot.last_coherence_vowel — caption ("sustained /o/ · 6.2 s"). */
  vowel?: string | null;
  /** snapshot.last_coherence_secs / lastOm.durationSecs — caption seconds. */
  seconds?: number | null;
  /** Repeat-capture compression: same gesture at 9/16 time (~1.8 s total).
   *  Parent passes true for every capture after the session's first. */
  compressed?: boolean;
  /** Fires exactly once when the beat completes (t ≥ DONE), or immediately
   *  under reduced motion. The parent uses this to restore any sibling dim;
   *  pointer events are never blocked either way. */
  onDone?: () => void;
  className?: string;
}

/* ════════════════════════════ geometry (viewBox) ═══════════════════════ */

const W = 611;
const H = 200;

const X0 = 100; //                 traces start (label column ends at 92)
const X_CONV0 = 400; //            lanes end / convergence begins
const X_CONV1 = 470; //            braid point — five become one
const X_METER = 506; //            meter track left edge
const METER_W = 90;
const BRAID_Y = 100; //            the single strand's centerline
const METER_Y = BRAID_Y - 4; //    meter track top (8 tall, centered on braid)

const LANE_Y = [28, 64, 100, 136, 172] as const; // lanes tightened vs science
const LANE_AMP = 24; //            m ∈ [0,1] → ±12px about the centerline

const GRATICULE_DIVISIONS = 8;
const GRID_STEP = W / GRATICULE_DIVISIONS;

/* ════════════════════════════ timeline (s, full beat) ══════════════════ */

const BEAT_FULL = 2.3; //          the five strands sweep X0 → X_CONV1
const STRAND_END_FULL = 2.6; //    braid strand extends X_CONV1 → X_METER
const BLINK_AT_FULL = 2.6; //      one 0.6 s raised-cosine blink, then stills
const BLINK_LEN_FULL = 0.6;
const DONE_FULL = 3.2;
const COMPRESS = 1.8 / DONE_FULL; // repeat captures: same gesture, 9/16 time

const TAUS = [0.6, 0.5, 0.9, 0.7, 0.55] as const; // per-strand settle τ (s)
const RIPPLE = 0.06; //            ρ — deterministic settle shimmer

/** ξ_i — five distinct deterministic incommensurate-sine pseudo-noises
 *  (same recipe as set-piece IV; no Math.random anywhere). */
const NOISES = TAUS.map((_, i) => makeNoise([2.9 + 1.7 * i, 6.7 + 2.3 * i, 12.1 + 3.1 * i]));
const ZERO_NOISE = (_s: number): number => 0;

/* ════════════════════════════ plate vocabulary ═════════════════════════ */
/* Console tokens only (tokens.css). The science TOKEN.* map is paper-world
   and illegible on --plate-bg #14171F — one page, one atmosphere. */

const PLATE = {
  text: 'var(--on-plate)', //      big readout, braid, cursor
  soft: 'var(--on-plate-soft)', // lane labels, caption
  weak: 'var(--on-plate-weak)', // weights, null lanes
  rule: 'var(--plate-rule)', //    graticule, lane rails, meter hairline
  track: 'var(--data-track)', //   meter track
} as const;

/** Strand strokes, top→bottom in CoherencePanel/weight order — plate-legible
 *  and semantically aligned with the viz (pitch echoes the F0 trace). */
const STRAND_COLORS = [
  'var(--pitch-line)', //     pitch     #8FB4E6
  'var(--on-plate-soft)', //  amplitude
  'var(--data-high-plate)', // harmonic
  'var(--data-mid-plate)', // spectral
  'var(--data-low-plate)', // resonance
] as const;

/* ════════════════════════════ helpers ══════════════════════════════════ */

const N = FIVE_DIMENSIONS_BASE.length;
const fmtWeight = (w: number): string => `.${String(Math.round(w * 100)).padStart(2, '0')}`;

function captionText(vowel: string | null | undefined, seconds: number | null | undefined): string {
  const what = vowel ? `sustained /${vowel}/` : 'sustained tone';
  return seconds != null && Number.isFinite(seconds) && seconds > 0
    ? `${what} · ${seconds.toFixed(1)} s`
    : what;
}

const BRAID_FULL_PATH = `M${X_CONV1} ${BRAID_Y} L${X_METER} ${BRAID_Y}`;

/* ════════════════════════════ component ════════════════════════════════ */

export default function ScoreReveal({
  metrics,
  index,
  vowel,
  seconds,
  compressed = false,
  onDone,
  className,
}: ScoreRevealProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const strandRefs = useRef<(SVGPathElement | null)[]>([]);
  const braidRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGRectElement>(null);
  const cursorRef = useRef<SVGGElement>(null);
  const readoutRef = useRef<SVGTextElement>(null);

  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<'play' | 'rest'>('play');

  /* The repeat beat: same gesture at 9/16 time. */
  const T = compressed ? COMPRESS : 1;
  const BEAT = BEAT_FULL * T;
  const STRAND_END = STRAND_END_FULL * T;
  const BLINK_AT = BLINK_AT_FULL * T;
  const BLINK_LEN = BLINK_LEN_FULL * T;
  const DONE = DONE_FULL * T;

  /* Latch the real values once per mount (the parent remounts per capture
     via key={lastOm.capturedAt}, so these never tear mid-beat). */
  const model = useMemo(() => {
    const raw = [metrics.pitch, metrics.amplitude, metrics.harmonic, metrics.spectral, metrics.resonance];
    const present = raw.map((v) => v != null && Number.isFinite(v));
    // Geometry-only clamp [0.05, 0.98]; the readout text never clamps.
    const targets = raw.map((v, i) => (present[i] ? clamp(v as number, 0.05, 0.98) : 0.5));
    // Starts derived deterministically from each target so every strand
    // visibly travels — no scripted spread, no random.
    const starts = targets.map((t, i) => (present[i] ? clamp(t - 0.35, 0.05, 0.6) : 0.5));
    const weights = FIVE_DIMENSIONS_BASE.map((d) => d.weight);
    const braid = makeBraid({
      laneY: LANE_Y,
      laneAmp: LANE_AMP,
      x0: X0,
      xConv0: X_CONV0,
      xConv1: X_CONV1,
      braidY: BRAID_Y,
      beat: BEAT,
      targets,
      starts,
      taus: TAUS.map((tau) => tau * T), // settle scales with the beat
      ripple: RIPPLE,
      noises: NOISES.map((noise, i) => (present[i] ? noise : ZERO_NOISE)),
      // no dip — real measurement, no scripted transients
    });
    return { present, weights, braid };
    // metrics/T are latched per mount (remount-by-key); deps for honesty.
  }, [metrics.pitch, metrics.amplitude, metrics.harmonic, metrics.spectral, metrics.resonance, T]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The animated mean: harmonic mean of the PRESENT lanes only (null lanes
     excluded); purely a motion path — the printed number snaps to `index`. */
  const animatedIndex = (s: number): number => {
    const vals: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!model.present[i]) continue;
      vals.push(model.braid.metric(i, s, false));
      wts.push(model.weights[i]);
    }
    if (vals.length === 0) {
      // All five null (shouldn't happen post-capture): sweep the fill to the
      // real index directly.
      return clamp01(index) * clamp01(s / BEAT);
    }
    return weightedHarmonicMean(vals, wts);
  };

  /* onDone — exactly once, whether animated or reduced. */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneFiredRef = useRef(false);
  const fireDone = () => {
    if (doneFiredRef.current) return;
    doneFiredRef.current = true;
    onDoneRef.current?.();
  };

  useEffect(() => {
    if (reduced) fireDone(); // the composed frame IS the moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useRafLoop(
    svgRef,
    (t) => {
      const s = Math.min(t, DONE);
      const snapped = s >= STRAND_END; // past settle, the core's number rules

      // The five strands, redrawn from 0 (deterministic — same s, same ink).
      for (let i = 0; i < N; i++) {
        strandRefs.current[i]?.setAttribute('d', model.braid.strandPath(i, s, snapped));
      }

      // The single braided strand extends to the meter after the beat.
      const headX =
        s <= BEAT ? X_CONV1 : lerp(X_CONV1, X_METER, clamp01((s - BEAT) / (STRAND_END - BEAT)));
      braidRef.current?.setAttribute(
        'd',
        s > BEAT ? `M${X_CONV1} ${BRAID_Y} L${headX.toFixed(2)} ${BRAID_Y}` : '',
      );

      // The readout: counts up via the live harmonic mean of the eased
      // values, then SNAPS to the Rust core's last_coherence_index — the JS
      // mean animates, it never gets to be the truth.
      const v = snapped ? clamp01(index) : clamp01(animatedIndex(s));
      const f = fillRef.current;
      if (f) {
        f.setAttribute('width', (METER_W * v).toFixed(2));
        f.setAttribute('fill', fillColorPlate(v));
      }
      if (readoutRef.current) {
        readoutRef.current.textContent = snapped ? index.toFixed(2) : v.toFixed(2);
      }

      // The crosshair cursor: sweeps with the head, parks, one blink, stills.
      const cx = Math.min(s <= BEAT ? model.braid.xOf(s) : headX, X_METER - 4);
      const c = cursorRef.current;
      if (c) {
        c.setAttribute('transform', `translate(${cx.toFixed(2)} 0)`);
        c.setAttribute('opacity', blinkOpacity(s, BLINK_AT, BLINK_LEN).toFixed(3));
      }

      if (t >= DONE) {
        setPhase('rest'); // loop disables; the record stays
        fireDone();
      }
    },
    { enabled: phase === 'play' },
  );

  /* Composed final frame for reduced motion (and the initial paint before
     the first rAF tick — empty under animation, refs own every frame after).
     Under reduced motion this complete frame, with the true number, IS the
     reveal — not a lesser one. */
  const fin = reduced
    ? {
        strands: FIVE_DIMENSIONS_BASE.map((_, i) => model.braid.strandPath(i, BEAT, true)),
        braid: BRAID_FULL_PATH,
        meterW: METER_W * clamp01(index),
        meterFill: fillColorPlate(clamp01(index)),
        readout: index.toFixed(2),
        cursor: `translate(${X_METER - 4} 0)`,
        cursorOpacity: 1,
      }
    : {
        strands: FIVE_DIMENSIONS_BASE.map(() => ''),
        braid: '',
        meterW: 0,
        meterFill: fillColorPlate(0),
        readout: '—',
        cursor: 'translate(0 0)',
        cursorOpacity: 0,
      };

  return (
    <div className={[styles.reveal, className].filter(Boolean).join(' ')}>
      {/* width/height come from ScoreReveal.module.css (an SVG height
          attribute can't be "auto" — it throws a DOM error). */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Coherence index ${index.toFixed(2)} — the five measured sub-metrics (pitch, amplitude, harmonic, spectral, resonance) braid into one weighted harmonic mean. ${captionText(vowel, seconds)}.`}
      >
        {/* graticule — plate register; 0.18 vanishes on #14171F, 0.3 reads */}
        <g stroke={PLATE.rule} strokeWidth={STROKE.hair} opacity={0.3}>
          {Array.from({ length: GRATICULE_DIVISIONS - 1 }, (_, k) => (
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

        {/* the five lane rails */}
        <g stroke={PLATE.rule} strokeWidth={STROKE.hair} opacity={0.55}>
          {LANE_Y.map((y) => (
            <line key={y} x1={X0} x2={X_CONV0} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* lane labels + weights — weights in on-plate-weak per the spec */}
        {FIVE_DIMENSIONS_BASE.map((d, i) => (
          <g key={d.key}>
            <text x={8} y={LANE_Y[i] + 4} style={SVG_LABEL_STYLE} fill={PLATE.soft}>
              {d.label}
            </text>
            <text x={92} y={LANE_Y[i] + 4} textAnchor="end" style={SVG_READOUT_STYLE} fill={PLATE.weak}>
              {fmtWeight(d.weight)}
            </text>
          </g>
        ))}

        {/* the five strands — null lanes draw flat and dimmed (on-plate-weak) */}
        {FIVE_DIMENSIONS_BASE.map((d, i) => (
          <path
            key={d.key}
            ref={(el) => {
              strandRefs.current[i] = el;
            }}
            d={fin.strands[i]}
            fill="none"
            stroke={model.present[i] ? STRAND_COLORS[i] : PLATE.weak}
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
          stroke={PLATE.text}
          strokeWidth={STROKE.braid}
          vectorEffect="non-scaling-stroke"
        />

        {/* the Index meter — same track + ramp as CoherenceBar, visibly the
            same instrument as the panel bars */}
        <rect
          x={X_METER}
          y={METER_Y}
          width={METER_W}
          height={8}
          fill={PLATE.track}
          stroke={PLATE.rule}
          strokeWidth={STROKE.hair}
          vectorEffect="non-scaling-stroke"
        />
        <rect ref={fillRef} x={X_METER} y={METER_Y} width={fin.meterW} height={8} fill={fin.meterFill} />
        <text
          ref={readoutRef}
          x={X_METER + METER_W}
          y={82}
          textAnchor="end"
          style={{ ...SVG_READOUT_STYLE, fontSize: 22 }}
          fill={PLATE.text}
        >
          {fin.readout}
        </text>
        <text x={X_METER} y={124} style={SVG_LABEL_STYLE} fill={PLATE.soft}>
          coherence index
        </text>
        {/* end-anchored at the right margin — start-anchored at X_METER the
            caption runs past the viewBox edge and clips mid-word */}
        <text x={W - 4} y={140} textAnchor="end" style={SVG_READOUT_STYLE} fill={PLATE.weak}>
          {captionText(vowel, seconds)}
        </text>

        {/* the crosshair cursor — sweeps, parks, one blink, stills */}
        <g
          ref={cursorRef}
          transform={fin.cursor}
          opacity={fin.cursorOpacity}
          stroke={PLATE.text}
          strokeWidth={STROKE.hair}
        >
          <line x1={0} x2={0} y1={14} y2={H - 14} vectorEffect="non-scaling-stroke" />
          <line
            x1={-CURSOR.cross}
            x2={CURSOR.cross}
            y1={BRAID_Y}
            y2={BRAID_Y}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </div>
  );
}
