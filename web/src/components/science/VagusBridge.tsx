/* ── VagusBridge — set-piece II · ONE NERVE, HEART & VOICE ───────────────────
   A single continuous 1.5px ink line — the vagus — drawn from a small
   two-chamber heart glyph (lower-left) up to a larynx cartilage outline
   (upper-right). On reveal the line draws itself on (700ms, after the 620ms
   prose fade); then, while on-screen, a luminous pulse is born at the heart
   on each cardiac beat and travels the line as a moving width/luminance
   bulge, arriving ~0.9s later at the larynx, which ticks in sync.

   The honest math: respiratory sinus arrhythmia. Instantaneous heart rate
   HR(t) = HR0 + RSA·sin(2π·f_resp·t) with HR0 = 1.0 Hz, RSA = ±0.13 Hz,
   f_resp = 0.1 Hz (one 10s om-exhale). Cardiac phase Θ(t) = 2π∫HR dt is
   ACCUMULATED per frame; a beat launches whenever Θ crosses a multiple of 2π.
   Pulse envelope along normalized arc-position u for a pulse at p = τ/0.9:
   g(u) = exp(−((u − p)/0.06)²); stroke width w = 1.0 + 2.0·g (peaking at the
   locked 3.0px). Heart flare is
   g(0), larynx tick is g(1) — one rhythm governs both ends, and the
   beat-to-beat interval visibly breathes.

   Reduced motion: line fully drawn, both nodes lit, ONE pulse frozen at the
   midpoint as a static width-bulge — the bridge as a held diagram. That frame
   is composed imperatively in a layout effect (NOT via a key remount: the
   useInView/useRafLoop observers hold the stable ref object, so swapping the
   <svg> out from under them would leave them watching a detached node).
   Off-screen: useRafLoop pauses the loop automatically.

   NOTE — deliberate, owner-visible decision (not a silent drop): panel graft
   block 1's hero→vagus single-handoff match-cut (the hero's resolved waveform
   exiting downward to BECOME this line) is not implemented. It directly
   conflicts with this set-piece's locked draw-on storyboard (the line draws
   itself heart→larynx on reveal, a full viewport below the hero's resting
   frame). The draw-on storyboard wins; revisit with the owner if the
   match-cut should replace it. */

import { useLayoutEffect, useRef, type ReactElement } from 'react';
import {
  useInView,
  useRafLoop,
  usePrefersReducedMotion,
  easeHouse,
  clamp01,
} from './motion';
import { TOKEN, STROKE, GRATICULE, SVG_LABEL_STYLE, VIEW } from './palette';
import marginalia from './marginalia.module.css';

/* ════════════════════════════ geometry (module-level, computed once) ════ */

const W = VIEW.width;
const H = VIEW.bridgeHeight;

/* The vagus: one calm anatomical cubic from heart node to larynx node. */
const P0 = { x: 106, y: 150 }; // heart node (lower-left)
const C1 = { x: 220, y: 154 };
const C2 = { x: 360, y: 40 };
const P3 = { x: 512, y: 46 }; // larynx node (upper-right)

const PATH_D = `M ${P0.x} ${P0.y} C ${C1.x} ${C1.y} ${C2.x} ${C2.y} ${P3.x} ${P3.y}`;

function bezier(t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * P0.x + b * C1.x + c * C2.x + d * P3.x,
    y: a * P0.y + b * C1.y + c * C2.y + d * P3.y,
  };
}

/* Sample the curve into short segments so stroke width can vary along it
   (SVG cannot vary width within one path). 72 segments ≈ smooth bulge. */
const SEGMENTS = 72;
const PTS: { x: number; y: number }[] = [];
for (let i = 0; i <= SEGMENTS; i++) PTS.push(bezier(i / SEGMENTS));

/* Cumulative arc length → total length + each segment's midpoint fraction. */
const CUM: number[] = [0];
for (let i = 1; i <= SEGMENTS; i++) {
  const dx = PTS[i].x - PTS[i - 1].x;
  const dy = PTS[i].y - PTS[i - 1].y;
  CUM.push(CUM[i - 1] + Math.hypot(dx, dy));
}
const LEN = CUM[SEGMENTS];
const UMID: number[] = [];
for (let i = 0; i < SEGMENTS; i++) UMID.push((CUM[i] + CUM[i + 1]) / 2 / LEN);

const SEG_D: string[] = [];
for (let i = 0; i < SEGMENTS; i++) {
  SEG_D.push(
    `M ${PTS[i].x.toFixed(2)} ${PTS[i].y.toFixed(2)} L ${PTS[i + 1].x.toFixed(2)} ${PTS[i + 1].y.toFixed(2)}`,
  );
}

/* Graticule verticals — 1px ghosted measurement grid behind the anatomy. */
const GRID_X: number[] = [];
for (let k = 1; k < GRATICULE.divisions; k++) GRID_X.push((k * W) / GRATICULE.divisions);

/* ════════════════════════════ the honest physiology ═════════════════════ */

const HR0 = 1.0; //        baseline heart rate, Hz (60 bpm)
const RSA = 0.13; //       respiratory sinus arrhythmia, ±Hz (≈ ±8 bpm)
const F_RESP = 0.1; //     one 10s breath — the sustained om exhale
const TRAVEL = 0.9; //     pulse travel time heart → larynx, s
const SIGMA = 0.06; //     pulse envelope width, fraction of arc length
const DELAY = 0.62; //     wait for the prose Reveal fade (620ms)
const DRAW_DUR = 0.7; //   the connect: stroke-dashoffset draw-on, s
const PULSE_W0 = 1.0; //   pulse overlay base width — w(s) = 1.0 + 2.0·g(s),
const PULSE_GAIN = 2.0; // peaking at the storyboard's locked 3.0px
const NODE_R = 3.5;

/** Pulse envelope at arc fraction u for a pulse whose head is at fraction p. */
const gauss = (u: number, p: number): number => Math.exp(-(((u - p) / SIGMA) ** 2));

/* ════════════════════════════ component ═════════════════════════════════ */

export default function VagusBridge(props: { className?: string }): ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const segRefs = useRef<(SVGPathElement | null)[]>([]);
  const nodesRef = useRef<SVGGElement>(null);
  const heartNodeRef = useRef<SVGCircleElement>(null);
  const larynxNodeRef = useRef<SVGCircleElement>(null);
  const heartLitRef = useRef<SVGCircleElement>(null);
  const larynxLitRef = useRef<SVGCircleElement>(null);
  const foldsRef = useRef<SVGGElement>(null);

  const reduced = usePrefersReducedMotion();
  const armed = useInView(svgRef, { once: true }); // fires with the prose Reveal

  /* Discrete sim state lives in a ref — never React state per frame. */
  const sim = useRef({ connected: false, theta: 0, beats: 0, pulses: [] as number[] });

  useRafLoop(
    svgRef,
    (t, dt) => {
      const s = sim.current;

      /* — connect: 700ms draw-on from heart to larynx, after the prose fade — */
      if (!s.connected) {
        const dprog = clamp01((t - DELAY) / DRAW_DUR);
        const draw = easeHouse(dprog);
        lineRef.current?.setAttribute('stroke-dashoffset', String(LEN * (1 - draw)));
        nodesRef.current?.setAttribute('opacity', String(0.45 + 0.55 * draw));
        if (dprog < 1) return;
        s.connected = true; // beats begin the moment the line connects
      }

      /* — cardiac phase, breathing with respiration (RSA) — */
      const hr = HR0 + RSA * Math.sin(2 * Math.PI * F_RESP * (t - DELAY - DRAW_DUR));
      s.theta += 2 * Math.PI * hr * dt; // Θ accumulated, never hr·t
      const crossings = Math.floor(s.theta / (2 * Math.PI));
      if (crossings >= s.beats) {
        s.beats = crossings + 1;
        s.pulses.push(t); // a beat is born at the heart node
      }
      while (s.pulses.length > 0 && (t - s.pulses[0]) / TRAVEL > 1.3) s.pulses.shift();

      /* — the traveling bulge: width + luminance only, never a particle — */
      let g0 = 0; // heart flare
      let g1 = 0; // larynx tick
      for (const t0 of s.pulses) {
        const p = (t - t0) / TRAVEL;
        g0 += gauss(0, p);
        g1 += gauss(1, p);
      }
      g0 = Math.min(g0, 1);
      g1 = Math.min(g1, 1);

      for (let i = 0; i < SEGMENTS; i++) {
        const el = segRefs.current[i];
        if (!el) continue;
        let g = 0;
        for (const t0 of s.pulses) g += gauss(UMID[i], (t - t0) / TRAVEL);
        g = Math.min(g, 1);
        el.setAttribute('stroke-width', String(PULSE_W0 + PULSE_GAIN * g));
        el.setAttribute('stroke-opacity', g < 0.004 ? '0' : g.toFixed(3));
      }

      /* — the two ends share the one rhythm — */
      heartNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair + 2 * g0));
      heartLitRef.current?.setAttribute('stroke-opacity', g0.toFixed(3));
      larynxNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair + 2 * g1));
      larynxLitRef.current?.setAttribute('stroke-opacity', g1.toFixed(3));
      foldsRef.current?.setAttribute('opacity', (0.3 + 0.7 * g1).toFixed(3)); // fold-tension tick
    },
    { enabled: armed && !reduced },
  );

  /* Compose the two static frames imperatively (the loop owns every frame in
     between). Reduced: line fully drawn, BOTH nodes lit (warm rings on), one
     pulse frozen at the line's midpoint — the bridge as a held diagram. Live:
     reset to the pre-draw state (or the connected state, if the sim already
     ran) so a mid-visit OS flip lands cleanly in either direction. */
  useLayoutEffect(() => {
    const setSeg = (i: number, g: number) => {
      const el = segRefs.current[i];
      if (!el) return;
      el.setAttribute('stroke-width', String(PULSE_W0 + PULSE_GAIN * g));
      el.setAttribute('stroke-opacity', g < 0.004 ? '0' : Math.min(g, 1).toFixed(3));
    };
    if (reduced) {
      lineRef.current?.setAttribute('stroke-dashoffset', '0');
      nodesRef.current?.setAttribute('opacity', '1');
      for (let i = 0; i < SEGMENTS; i++) setSeg(i, gauss(UMID[i], 0.5));
      heartNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair));
      larynxNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair));
      heartLitRef.current?.setAttribute('stroke-opacity', '1');
      larynxLitRef.current?.setAttribute('stroke-opacity', '1');
      foldsRef.current?.setAttribute('opacity', '1');
    } else {
      const connected = sim.current.connected;
      lineRef.current?.setAttribute('stroke-dashoffset', connected ? '0' : String(LEN));
      nodesRef.current?.setAttribute('opacity', connected ? '1' : '0.45');
      for (let i = 0; i < SEGMENTS; i++) setSeg(i, 0);
      heartNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair));
      larynxNodeRef.current?.setAttribute('stroke-width', String(STROKE.hair));
      heartLitRef.current?.setAttribute('stroke-opacity', '0');
      larynxLitRef.current?.setAttribute('stroke-opacity', '0');
      foldsRef.current?.setAttribute('opacity', '0.3');
    }
  }, [reduced]);

  return (
    <div className={[marginalia.figure, props.className].filter(Boolean).join(' ')}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="One continuous line links a heart glyph to a larynx glyph — the vagus nerve. A single pulse travels it from heart to voice, its beat-to-beat interval slowly breathing."
    >
      {/* graticule — full-bleed y 0→H, the one register all four panels share */}
      {GRID_X.map((x) => (
        <line
          key={x}
          x1={x}
          y1={0}
          x2={x}
          y2={H}
          stroke={TOKEN.rule}
          strokeWidth={STROKE.hair}
          opacity={GRATICULE.opacityLight}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* channel label (left rail) — the observatory's second panel */}
      <text x={10} y={18} fill={TOKEN.accentSoft} style={SVG_LABEL_STYLE} className={marginalia.svgOnly}>
        ch2 · vagus
      </text>

      {/* the vagus — THE line, the only thick element. Initial attributes are
          the pre-draw frame; the layout effect + loop own them from then on
          (props stay constant so React's diff never fights the refs). */}
      <path
        ref={lineRef}
        d={PATH_D}
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.line}
        strokeLinecap="butt"
        strokeDasharray={LEN}
        strokeDashoffset={LEN}
        vectorEffect="non-scaling-stroke"
      />

      {/* the pulse — per-segment width/luminance bulge in the warm live-signal ochre */}
      <g aria-hidden="true">
        {SEG_D.map((d, i) => (
          <path
            key={i}
            ref={(el) => {
              segRefs.current[i] = el;
            }}
            d={d}
            fill="none"
            stroke={TOKEN.dataMid}
            strokeLinecap="butt"
            strokeWidth={PULSE_W0}
            strokeOpacity={0}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {/* heart — a small two-chamber glyph, 1px stroke */}
      <g fill="none" stroke={TOKEN.accent} strokeWidth={STROKE.hair}>
        <ellipse cx={88} cy={166} rx={9} ry={12} transform="rotate(-14 88 166)" vectorEffect="non-scaling-stroke" />
        <ellipse cx={103} cy={168} rx={10} ry={13} transform="rotate(8 103 168)" vectorEffect="non-scaling-stroke" />
      </g>

      {/* larynx — a simple cartilage outline with a v-notch, 1px stroke */}
      <path
        d="M 498 12 L 508 27 L 512 23 L 516 27 L 526 12 L 522 38 L 502 38 Z"
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.hair}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
      {/* vocal-fold hairlines — they tick when the pulse arrives */}
      <g ref={foldsRef} stroke={TOKEN.accent} strokeWidth={STROKE.hair} opacity={0.3}>
        <line x1={506} y1={31} x2={518} y2={31} vectorEffect="non-scaling-stroke" />
        <line x1={505} y1={34.5} x2={519} y2={34.5} vectorEffect="non-scaling-stroke" />
      </g>

      {/* the two nodes — open circles, unlit until the line connects */}
      <g ref={nodesRef} opacity={0.45} fill="none">
        <circle ref={heartNodeRef} cx={P0.x} cy={P0.y} r={NODE_R} stroke={TOKEN.accent} strokeWidth={STROKE.hair} vectorEffect="non-scaling-stroke" />
        <circle ref={larynxNodeRef} cx={P3.x} cy={P3.y} r={NODE_R} stroke={TOKEN.accent} strokeWidth={STROKE.hair} vectorEffect="non-scaling-stroke" />
        {/* warm flare rings — luminance share of the beat (opacity = g) */}
        <circle ref={heartLitRef} cx={P0.x} cy={P0.y} r={NODE_R} stroke={TOKEN.dataMid} strokeWidth={STROKE.line} strokeOpacity={0} vectorEffect="non-scaling-stroke" />
        <circle ref={larynxLitRef} cx={P3.x} cy={P3.y} r={NODE_R} stroke={TOKEN.dataMid} strokeWidth={STROKE.line} strokeOpacity={0} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>

    {/* mobile marginalia — the channel label, moved inline-below (graft law) */}
    <div className={marginalia.below} aria-hidden="true">
      <span>ch2 · vagus</span>
    </div>
    </div>
  );
}
