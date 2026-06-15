import { useEffect, useRef } from 'react';
import type { Snapshot } from '../types/snapshot';
import { useCanvasSize } from '../viz/useCanvasSize';
import { clamp01, usePrefersReducedMotion, useRafLoop } from './science/motion';
import {
  emaStep,
  steadinessReadings,
  blendReadings,
  steadinessWord,
  STEADINESS_REST,
  type SteadinessWord,
} from './steadiness';
import styles from './SettlingLine.module.css';

/* ── SettlingLine — the during-hold affordance (replaces SteadinessPresence) ──
   While a tone is held the focus band shows a calm living PITCH LINE that
   visibly converges onto its note as the tone steadies — the practice's actual
   act made visible. It is a practice-styled variant of viz/PitchTrack: the F0
   line on a log-frequency y-axis with a faint running-MEDIAN "home" gridline and
   the current note name set quietly at the right edge.

   Honest per-hop character (NOT decorative — this is signal, like a meter value):
   · line WIDTH/feather from jitter_cents — low jitter → hairline-crisp; high →
     feathered (a soft glow halo);
   · BRIGHTNESS from hnr_db + (1 − entropy) — clean → bright/definite; breathy →
     faint;
   · the line breaks across >2-hop unvoiced gaps (a dropped tone reads as an
     honest gap).

   Beneath the line, ONE soft small-caps word — finding it… → settling… →
   steady — reusing steadiness.ts thresholds. Never green/red, never a number.

   DATA-FLOW NOTE: the analyzer's pitch ring stores only [hop, f0]; it does NOT
   carry jitter/hnr/entropy per hop. So this component keeps its OWN small local
   ring of [hop, f0, jitter, hnr, entropy], appended whenever snapshot.hop_index
   changes (the same dedup the analyzer's accumulate uses) — that gives each
   drawn segment its own honest character. The ring is cleared when the analyzer
   stops running so a new hold starts clean.

   BRAND LAWS (motion.ts): the rAF loop auto-pauses off-screen and never ticks
   under prefers-reduced-motion. Under reduced motion the line renders STATICALLY
   at its current convergence (no scrolling) — but per-hop width/brightness MAY
   still update (that is signal, not decorative motion), so a static redraw fires
   whenever the latest hop changes; the word parks (its EMA stops accumulating,
   it just reads the raw present-tense reading). No Math.random, no library. */

interface Hop {
  hop: number;
  f0: number; // > 0
  jitter: number | null;
  hnr: number | null;
  entropy: number;
}

const RING_MAX = 240; // ~20 s of hops at ~12 hops/s — the visible settling window

// Brightness: HNR clarity + spectral order → 0..1 → alpha over the pitch hue.
const HNR_LO = 6; // dB — below this the tone is breathy (faint)
const HNR_HI = 22; // dB — by here it is a clean harmonic stack (bright)
const BRIGHT_MIN = 0.28; // the faintest a present voiced segment ever draws
const BRIGHT_MAX = 1.0;

// Feather (width): low jitter → hairline-crisp; high → a soft feathered halo.
const JITTER_CRISP = 4; // cents — at/under this the line is hairline-crisp
const JITTER_FEATHER = 45; // cents — by here the line is fully feathered

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Per-hop brightness 0..1 from HNR + spectral order. Null HNR → order alone. */
function brightnessOf(hnr: number | null, entropy: number): number {
  const order = clamp01(1 - entropy);
  const clarity =
    hnr == null ? 0.35 * order : 0.6 * smoothstep01(HNR_LO, HNR_HI, hnr) + 0.4 * order;
  return BRIGHT_MIN + (BRIGHT_MAX - BRIGHT_MIN) * clamp01(clarity);
}

/** Per-hop feather 0..1 from jitter (0 = crisp hairline, 1 = fully feathered).
 *  Null jitter (no stable F0 yet) reads as mostly feathered — "not yet readable". */
function featherOf(jitter: number | null): number {
  if (jitter == null) return 0.7;
  return smoothstep01(JITTER_CRISP, JITTER_FEATHER, Math.max(0, jitter));
}

/** Running median of the recent f0 values — the quiet "home" the tone converges
 *  onto. Median (not mean) so a brief swoop in doesn't drag the home line. */
function runningMedian(ring: readonly Hop[]): number | null {
  if (ring.length === 0) return null;
  const fs = ring.map((h) => h.f0).sort((a, b) => a - b);
  const mid = fs.length >> 1;
  return fs.length % 2 ? fs[mid] : (fs[mid - 1] + fs[mid]) / 2;
}

// The pitch-line hue (= --pitch-line #8FB4E6), kept as RGB so brightness can
// modulate alpha without a hue shift (definite vs faint, never a color verdict).
const PITCH_RGB = '143, 180, 230';
const PLATE_BG = '#14171F';
const HOME_RULE = 'rgba(231, 226, 214, 0.16)'; // faint parchment home gridline
const NOTE_FILL = 'rgba(231, 226, 214, 0.66)'; // the quiet right-edge note name

export default function SettlingLine({
  snapshot,
  running,
}: {
  snapshot: Snapshot | null;
  running: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const size = useCanvasSize(wrapRef);

  // latest snapshot for the loop/static closures
  const snapRef = useRef<Snapshot | null>(snapshot);
  snapRef.current = snapshot;

  // the local per-hop ring — carries the fields the analyzer's ring drops
  const ringRef = useRef<Hop[]>([]);
  const lastHopRef = useRef<number>(-1);

  // the word EMA + last-written word (only touch the DOM on change)
  const emaRef = useRef<number>(STEADINESS_REST);
  const lastWordRef = useRef<SteadinessWord | null>(null);

  // Clear the ring whenever the analyzer stops, so the next hold starts clean.
  useEffect(() => {
    if (!running) {
      ringRef.current = [];
      lastHopRef.current = -1;
      emaRef.current = STEADINESS_REST;
    }
  }, [running]);

  /** Ingest the current snapshot into the ring, deduped on hop_index. Returns
   *  true if a NEW hop landed (so the reduced-motion path knows to redraw). */
  const ingest = (s: Snapshot | null): boolean => {
    if (!s || s.hop_index === lastHopRef.current) return false;
    lastHopRef.current = s.hop_index;
    if (s.voiced && s.f0 != null && s.f0 > 0) {
      const ring = ringRef.current;
      ring.push({
        hop: s.hop_index,
        f0: s.f0,
        jitter: s.jitter_cents,
        hnr: s.hnr_db,
        entropy: s.entropy,
      });
      if (ring.length > RING_MAX) ring.shift();
    }
    return true;
  };

  const applyWord = (w: SteadinessWord) => {
    if (lastWordRef.current === w || !wordRef.current) return;
    lastWordRef.current = w;
    wordRef.current.textContent = w;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const dpr = size.dpr;
    const ring = ringRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PLATE_BG;
    ctx.fillRect(0, 0, W, H);

    const padX = 8 * dpr;
    const padY = 8 * dpr;
    const noteW = 30 * dpr; // reserve the right edge for the note name
    const plot = { l: padX, t: padY, r: W - padX - noteW, b: H - padY };
    const pw = plot.r - plot.l;
    const ph = plot.b - plot.t;
    if (pw <= 0 || ph <= 0) return;

    // Frequency range: fit the ring with padding, clamped to the chant range.
    let fmin = Infinity;
    let fmax = -Infinity;
    for (const h of ring) {
      if (h.f0 < fmin) fmin = h.f0;
      if (h.f0 > fmax) fmax = h.f0;
    }
    if (!Number.isFinite(fmin) || !Number.isFinite(fmax)) {
      fmin = 100;
      fmax = 400;
    }
    fmin = Math.max(fmin / 1.12, 65);
    fmax = Math.min(fmax * 1.12, 550);
    if (fmax <= fmin * 1.05) fmax = fmin * 1.5;

    const lfMin = Math.log(fmin);
    const lfMax = Math.log(fmax);
    const yOf = (f: number) =>
      plot.b - clamp01((Math.log(Math.max(f, 1)) - lfMin) / (lfMax - lfMin)) * ph;

    // The faint running-median "home" line — the note the tone converges onto.
    const home = runningMedian(ring);
    if (home != null) {
      const y = yOf(home);
      ctx.strokeStyle = HOME_RULE;
      ctx.lineWidth = Math.max(dpr * 0.75, 1);
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(plot.l, y);
      ctx.lineTo(plot.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (ring.length === 0) return;

    // Time axis: newest hop pinned to the right, the visible span to the left.
    const latestHop = ring[ring.length - 1].hop;
    const oldest = ring[0].hop;
    const windowHops = Math.max(latestHop - oldest, 1);
    const xOf = (hop: number) => plot.r - ((latestHop - hop) / windowHops) * pw;

    // The F0 line, drawn per-segment so each segment carries its own honest
    // width (jitter→feather) and brightness (hnr + 1−entropy). Broken across
    // >2-hop gaps. Feather = a soft wide stroke under a crisp core, so a
    // wandering tone reads "feathered" and a steady one "hairline-crisp".
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let prev: { x: number; y: number; hop: number } | null = null;
    for (const h of ring) {
      const x = xOf(h.hop);
      const y = yOf(h.f0);
      if (prev && h.hop - prev.hop <= 2) {
        const bright = brightnessOf(h.hnr, h.entropy);
        const feather = featherOf(h.jitter);
        // feathered halo (wide, dim) — only when the tone is wandering
        if (feather > 0.05) {
          ctx.strokeStyle = `rgba(${PITCH_RGB}, ${(bright * 0.22 * feather).toFixed(3)})`;
          ctx.lineWidth = Math.max(dpr * (2 + feather * 6), 1);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        // crisp core — full where jitter is low, thinner+fainter when feathered
        const coreAlpha = bright * (1 - 0.35 * feather);
        ctx.strokeStyle = `rgba(${PITCH_RGB}, ${clamp01(coreAlpha).toFixed(3)})`;
        ctx.lineWidth = Math.max(dpr * (1.6 - 0.6 * feather), 1);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = { x, y, hop: h.hop };
    }

    // The current note name, set quietly at the right edge near the line's head.
    const s = snapRef.current;
    const note = s?.voiced ? s.note : null;
    if (note && prev) {
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.fillStyle = NOTE_FILL;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const ny = Math.min(Math.max(prev.y, plot.t + 7 * dpr), plot.b - 7 * dpr);
      ctx.fillText(note, plot.r + 5 * dpr, ny);
    }
  };

  // Normal motion: redraw at display rate + advance the word EMA in wall-clock
  // time. The loop auto-pauses off-screen and never ticks under reduced motion.
  useRafLoop(wrapRef, (_t, dt) => {
    const s = snapRef.current;
    ingest(s);
    const voiced = !!s?.voiced;
    const target = voiced && s ? blendReadings(steadinessReadings(s)) : STEADINESS_REST;
    emaRef.current = emaStep(emaRef.current, target, dt);
    applyWord(steadinessWord(emaRef.current));
    draw();
  });

  // Reduced motion (and the first paint): NO scrolling animation. The parent
  // re-renders on every hop (~12/s), so this effect runs then; under reduced
  // motion we ingest + redraw STATICALLY at the current convergence — per-hop
  // width/brightness is signal and may update, but there is no per-frame
  // motion. The word parks at the raw present-tense reading (no EMA breathing).
  // Under normal motion the rAF loop owns redraws; this just paints the first
  // frame so the band is never blank for one rAF.
  useEffect(() => {
    if (!reduced) {
      draw();
      return;
    }
    ingest(snapRef.current);
    const s = snapRef.current;
    const raw = s?.voiced ? blendReadings(steadinessReadings(s)) : STEADINESS_REST;
    applyWord(steadinessWord(raw));
    draw();
    // re-runs on each render; the ingest dedup makes it cheap when the hop
    // has not advanced.
  });

  // a stable starting word so the band is never blank on first paint
  const initialWord: SteadinessWord = snapshot?.voiced
    ? steadinessWord(blendReadings(steadinessReadings(snapshot)))
    : 'finding it…';

  return (
    <span className={styles.root} aria-hidden="true">
      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={size.pxW}
          height={size.pxH}
          className={styles.canvas}
        />
      </div>
      <span ref={wordRef} className={styles.word}>
        {initialWord}
      </span>
    </span>
  );
}
