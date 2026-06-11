/* ── Set-piece 1 · THE HELD TONE RESOLVING (hero, plays on load) ─────────────
   A violent, hairy, aperiodic trace settles into ~3.5 clean repeating cycles
   of a real summed-harmonic waveform — the thesis image of the page.

   The math IS the acoustics (nothing faked):
   · 12 harmonics, a_k = (1/k)·e^(−k/8) normalized; base f0 = 110 Hz (A2).
   · Pitch jitter in cents c = (70(1−r)+4)·n_p; instantaneous f0 = 110·2^(c/1200),
     and phase is ACCUMULATED across the drawn window (Φ += 2π·f0·dτ), never f0·t.
   · Shimmer envelope A = 1 + 0.22(1−r)·n_a; aspiration b = 10^(−HNR/20)·n_w
     with HNR(r) = 4 + 18r dB. y = A·Σ a_k sin(kΦ+ψ_k) + b, normalized.
   · All noise is deterministic incommensurate-sine pseudo-noise (makeNoise) —
     frame-rate-independent, identical on every visit. No Math.random.
   · The corner readouts display the TRUE values: HNR(r) and 70(1−r)+4 cents.

   Beats: pre-roll flat baseline (0–0.4s) → cursor sweep erupts the line
   (0.4–1.0s) → r eases 0→1 (smootherstep over 3s) and the tone locks →
   cursor parks at right, one 0.6s blink, the ॐ rest mark fades in, and at
   t = 6.5s the loop stops on its composed final frame. Reduced motion renders
   that final frame (r = 1) statically — and if the OS flips it ON
   mid-animation, a layout effect re-composes that frame imperatively (halos
   retracted, cursor parked, readouts settled), since those attributes are
   driven by refs and React's vdom diff would never reset them.
   useRafLoop pauses it off-screen. */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  blinkOpacity,
  centsToRatio,
  clamp,
  dbToLin,
  harmonicAmps,
  goldenPhases,
  makeNoise,
  smootherstep,
  smoothstep,
  sumHarmonics,
  usePrefersReducedMotion,
  useRafLoop,
} from './motion';
import {
  GRATICULE,
  CURSOR,
  HALO,
  STROKE,
  SVG_LABEL_STYLE,
  SVG_READOUT_STYLE,
  TOKEN,
  VIEW,
} from './palette';
import styles from './HeroTone.module.css';
import marginalia from './marginalia.module.css';

/* ── geometry ── */
const W = VIEW.width;
const H = VIEW.heroHeight;
const CY = H / 2;
const GAIN = 86; // px per unit signal; bounded |y| ≤ 1 keeps the trace inside
const PTS = 280; // samples across the window (~2.2px spacing)

/* ── signal constants (the storyboard's math, verbatim) ── */
const F0 = 110; // Hz, A2
const CYCLES = 3.5; // clean repeating cycles shown when locked
const WINDOW_S = CYCLES / F0; // seconds of signal across the width
const N_HARMONICS = 12;
const AMPS = harmonicAmps(N_HARMONICS, 8);
const PSIS = goldenPhases(N_HARMONICS);
const SLOW_STRETCH = 6; // window-time stretch so slow wobble reads within the trace

/* sanctioned deterministic noise (hero presets per spec) */
const noisePitch = makeNoise([7.3, 13.7, 23.1]); // slow — pitch wobble
const noiseShimmer = makeNoise([5.1, 11.9]); // envelope heave
const noiseAspiration = makeNoise([310, 517, 829, 1213]); // broadband fuzz
const noiseHalo = [
  makeNoise([11.3, 19.7]),
  makeNoise([9.1, 23.9]),
  makeNoise([15.7, 8.3]),
] as const;
const HALO_BASE_DY = [-HALO.offsetPx, 0.9, HALO.offsetPx] as const;

/* ── timeline (seconds of active animation time) ── */
const T_SWEEP_START = 0.4;
const T_SWEEP_END = 1.0;
const T_BLINK_START = 4.0;
const T_BLINK_LEN = 0.6;
const T_OM = 4.4; // the rest mark fades in once the tone has settled
const T_FREEZE = 6.5; // the beat resolves; the set-piece RESTS on this frame

const hnrOf = (r: number) => 4 + 18 * r; // dB
const jitterOf = (r: number) => 70 * (1 - r) + 4; // cents (residual 4¢ at rest)
const resolveOf = (t: number) => smootherstep(0, 1, (t - T_SWEEP_START) / 3.0);

/** One drawn frame of the waveform: phase accumulated across the window.
 *  Returns the path and the terminus y (where the held tone exits the frame —
 *  the ॐ rest mark parks against it). */
function buildPath(t: number, r: number, gateAnchor: number): { d: string; endY: number } {
  const cAmp = jitterOf(r);
  const shAmp = 0.22 * (1 - r);
  const bAmp = dbToLin(-hnrOf(r));
  const norm = 1 + shAmp + bAmp; // worst-case bound → |y| ≤ 1
  const dTau = WINDOW_S / (PTS - 1);
  let phi = 0;
  let d = '';
  let endY = CY;
  for (let j = 0; j < PTS; j++) {
    const tau = j * dTau;
    const x = (j / (PTS - 1)) * W;
    const cents = cAmp * noisePitch(t + tau * SLOW_STRETCH);
    const f0 = F0 * centsToRatio(cents);
    if (j > 0) phi += 2 * Math.PI * f0 * dTau; // Φ = 2π∫f0 dτ — accumulated
    const env = 1 + shAmp * noiseShimmer(t + tau * SLOW_STRETCH);
    const asp = bAmp * noiseAspiration(t + tau);
    const y = (env * sumHarmonics(phi, AMPS, PSIS) + asp) / norm;
    // eruption gate: signal exists only where the cursor has already passed
    const gate = 1 - smoothstep(gateAnchor - 24, gateAnchor, x);
    endY = CY - y * GAIN * gate;
    d += `${j === 0 ? 'M' : 'L'}${x.toFixed(1)} ${endY.toFixed(2)}`;
  }
  return { d, endY };
}

const FLAT_D = `M0 ${CY} L${W} ${CY}`;

/* The composed final frame (r = 1, deterministic): the reduced-motion render
   AND the exact frame the animation freezes on at T_FREEZE. */
const SETTLED = buildPath(T_FREEZE, 1, W + 200);
/* The ॐ rest mark parks at the clean held period's terminus — the settled
   trace's right-edge endpoint — not loose in a corner. */
const OM_X = W - 4;
const OM_Y = clamp(SETTLED.endY - 8, 16, H - 8);

/* pad with no-break spaces (SVG collapses plain ones); mono keeps digits put */
const fmtHnr = (v: number) => `hnr ${v.toFixed(1).padStart(4, ' ')} dB`;
const fmtJitter = (v: number) =>
  `jitter ${String(Math.round(v)).padStart(2, ' ')} ¢`;

export default function HeroTone({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [done, setDone] = useState(false);
  const [omShown, setOmShown] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const traceRef = useRef<SVGPathElement>(null);
  const haloRefs = useRef<Array<SVGUseElement | null>>([null, null, null]);
  const cursorRef = useRef<SVGGElement>(null);
  const hnrRef = useRef<SVGTextElement>(null);
  const jitterRef = useRef<SVGTextElement>(null);
  const hnrBelowRef = useRef<HTMLSpanElement>(null);
  const jitterBelowRef = useRef<HTMLSpanElement>(null);
  const omArmed = useRef(false);
  const lastHnrText = useRef('');
  const lastJitterText = useRef('');

  const pathId = `hero-tone-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const drawFrame = (t: number) => {
    const r = resolveOf(t);

    // waveform — the eruption edge sweeps with the cursor, then exits right
    const sweep = ((t - T_SWEEP_START) / (T_SWEEP_END - T_SWEEP_START)) * (W - 1);
    const gateAnchor = t < T_SWEEP_START ? -10 : Math.min(sweep, W + 200);
    traceRef.current?.setAttribute('d', buildPath(t, r, gateAnchor).d);

    // noise-halo — 3 offset ghost copies, retracting into the stroke as r→1
    const haloK = 1 - r;
    for (let i = 0; i < 3; i++) {
      const el = haloRefs.current[i];
      if (!el) continue;
      const dy = haloK * (HALO_BASE_DY[i] + 0.8 * noiseHalo[i](t));
      el.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`);
      el.setAttribute('opacity', (HALO.opacity * haloK).toFixed(3));
    }

    // cursor — waits right, sweeps once, parks right, one 0.6s blink, stills
    const cursorX = clamp(sweep, 0, W - 1);
    const cx = t < T_SWEEP_START ? W - 1 : cursorX;
    let cop = blinkOpacity(t, T_BLINK_START, T_BLINK_LEN); // the shared idiom
    if (t >= T_SWEEP_START - 0.08 && t < T_SWEEP_START) cop = 0; // dip across the jump
    const cursor = cursorRef.current;
    if (cursor) {
      cursor.setAttribute('transform', `translate(${cx.toFixed(1)} 0)`);
      cursor.setAttribute('opacity', cop.toFixed(3));
    }

    // readouts — TRUE computed values, driven by the same r; the SVG margin
    // log and its inline-below mobile twin carry the same numbers
    const hnrText = fmtHnr(hnrOf(r));
    if (hnrText !== lastHnrText.current) {
      if (hnrRef.current) hnrRef.current.textContent = hnrText;
      if (hnrBelowRef.current) hnrBelowRef.current.textContent = hnrText;
      lastHnrText.current = hnrText;
    }
    const jitterText = fmtJitter(jitterOf(r));
    if (jitterText !== lastJitterText.current) {
      if (jitterRef.current) jitterRef.current.textContent = jitterText;
      if (jitterBelowRef.current) jitterBelowRef.current.textContent = jitterText;
      lastJitterText.current = jitterText;
    }
  };

  useRafLoop(
    svgRef,
    (t) => {
      drawFrame(Math.min(t, T_FREEZE));
      if (t >= T_OM && !omArmed.current) {
        omArmed.current = true;
        setOmShown(true);
      }
      if (t >= T_FREEZE) setDone(true); // rest — the frozen frame === SETTLED.d
    },
    { enabled: !done },
  );

  /* If reduced motion flips ON mid-animation, the loop stops but every
     ref-driven attribute (halo opacity/transform, cursor, readout text nodes)
     keeps its last animated value — React's vdom diff can't reset what it
     never owned. Re-compose the settled frame imperatively. */
  useLayoutEffect(() => {
    if (reduced) drawFrame(T_FREEZE);
    // drawFrame is stable in everything but refs; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  /* Static props are the pre-roll frame (animated) or the settled frame
     (reduced motion); per-frame updates go through refs, never state. */
  const settled = reduced;
  const initialHnr = settled ? hnrOf(1) : hnrOf(0);
  const initialJitter = settled ? jitterOf(1) : jitterOf(0);
  const graticuleX = Array.from(
    { length: GRATICULE.divisions - 1 },
    (_, i) => ((i + 1) * W) / GRATICULE.divisions,
  );

  return (
    <div className={[marginalia.figure, className].filter(Boolean).join(' ')}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="A jittery, noisy vocal waveform settles into one clean sustained tone: harmonics-to-noise ratio rises from 4 to 22 decibels as pitch jitter falls from 70 to 4 cents."
    >
      {/* graticule: 1px verticals every ⅛ width + the centerline, ghosted */}
      <g stroke={TOKEN.rule} strokeWidth={STROKE.hair} opacity={GRATICULE.opacityLight}>
        {graticuleX.map((x) => (
          <line key={x} x1={x} y1={0} x2={x} y2={H} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} y1={CY} x2={W} y2={CY} vectorEffect="non-scaling-stroke" />
      </g>

      <defs>
        {/* the one trace; styled per <use> so the halo can re-stroke it thin */}
        <path
          id={pathId}
          ref={traceRef}
          d={settled ? SETTLED.d : FLAT_D}
          fill="none"
          strokeLinecap="butt"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </defs>

      {/* noise-halo: 3 ghost copies at 0.5px, ±2px wander, gone at rest */}
      <g stroke={TOKEN.accent} strokeWidth={HALO.width} fill="none">
        {HALO_BASE_DY.map((dy, i) => (
          <use
            key={i}
            ref={(el) => {
              haloRefs.current[i] = el;
            }}
            href={`#${pathId}`}
            transform={`translate(0 ${dy})`}
            opacity={0}
          />
        ))}
      </g>

      {/* the tone — 1.5px ink, the only thick element */}
      <use href={`#${pathId}`} stroke={TOKEN.accent} strokeWidth={STROKE.line} fill="none" />

      {/* crosshair cursor — shared idiom; parks at right, blinks once, stills */}
      <g
        ref={cursorRef}
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        transform={`translate(${W - 1} 0)`}
        opacity={1}
      >
        <line x1={0} y1={0} x2={0} y2={H} vectorEffect="non-scaling-stroke" />
        <line x1={-CURSOR.cross} y1={CY} x2={CURSOR.cross} y2={CY} vectorEffect="non-scaling-stroke" />
      </g>

      {/* channel label (left rail) + live instrument log (right margin) —
          hidden below 640px; the inline-below row carries them instead */}
      <text x={10} y={18} fill={TOKEN.accentSoft} style={SVG_LABEL_STYLE} className={marginalia.svgOnly}>
        ch1 · f0
      </text>
      <text
        ref={hnrRef}
        x={W - 10}
        y={18}
        textAnchor="end"
        fill={TOKEN.accentSoft}
        style={SVG_READOUT_STYLE}
        className={marginalia.svgOnly}
      >
        {fmtHnr(initialHnr)}
      </text>
      <text
        ref={jitterRef}
        x={W - 10}
        y={34}
        textAnchor="end"
        fill={TOKEN.accentSoft}
        style={SVG_READOUT_STYLE}
        className={marginalia.svgOnly}
      >
        {fmtJitter(initialJitter)}
      </text>

      {/* the ॐ rest mark — "the tone, held." (the page's one instance),
          parked at the settled trace's terminus, not loose in the corner */}
      <text
        x={OM_X}
        y={OM_Y}
        textAnchor="end"
        fontSize={SVG_LABEL_STYLE.fontSize}
        fill={TOKEN.accent}
        style={{ fontFamily: 'var(--devanagari)' }}
        className={omShown || settled ? styles.omVisible : styles.om}
      >
        {'ॐ'}
      </text>
    </svg>

    {/* mobile marginalia — the corner log, moved inline-below (graft law) */}
    <div className={marginalia.below} aria-hidden="true">
      <span>ch1 · f0</span>
      <span ref={hnrBelowRef} className={marginalia.num}>
        {fmtHnr(initialHnr)}
      </span>
      <span ref={jitterBelowRef} className={marginalia.num}>
        {fmtJitter(initialJitter)}
      </span>
    </div>
    </div>
  );
}
