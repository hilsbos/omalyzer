/* ── Shared braid kinematics — the FiveDimensions gesture, parameterized ────
   The pure strand math of science set-piece IV (settle exponential,
   convergence bend, 1¼-turn phase-offset weave, path sampler), lifted out so
   the science page's scripted demo and the console's score reveal are
   provably the same gesture with different inputs.

   Both callers now share it: `science/FiveDimensions.tsx` calls makeBraid
   with its scripted targets + the pedagogical harmonic dip; `ScoreReveal.tsx`
   calls it with a real capture's measured sub-metrics and no dip.

   World-agnostic by law: no colors, no tokens, no DOM — geometry and time
   only. Deterministic: callers supply the noise functions (makeNoise from
   science/motion.ts; never Math.random). */

import { clamp, lerp, smootherstep } from './science/motion';

/* ── The five-dimension identity, colorless ─────────────────────────────────
   {key, label, weight} only. Weights' source of truth:
   crates/core/src/coherence.rs:307–311 (0.25/0.15/0.30/0.15/0.15, combined
   by the weighted harmonic mean). ScoreReveal zips this with plate colors;
   science/palette.ts still re-declares the same quintuple independently
   (follow-up: derive it from this base). Order matters: it is the
   CoherencePanel order and the strand-target order. */
export const FIVE_DIMENSIONS_BASE = [
  { key: 'pitch', label: 'pitch', weight: 0.25 },
  { key: 'amplitude', label: 'amplitude', weight: 0.15 },
  { key: 'harmonic', label: 'harmonic', weight: 0.3 },
  { key: 'spectral', label: 'spectral', weight: 0.15 },
  { key: 'resonance', label: 'resonance', weight: 0.15 },
] as const;

export type FiveDimensionKey = (typeof FIVE_DIMENSIONS_BASE)[number]['key'];

export const FIVE_WEIGHTS: readonly number[] = FIVE_DIMENSIONS_BASE.map((d) => d.weight);

export interface BraidConfig {
  /** Lane centerlines, top → bottom (viewBox y units). */
  laneY: readonly number[];
  /** m ∈ [0,1] maps to ±laneAmp/2 about the lane centerline. */
  laneAmp: number;
  /** Traces start (x). */
  x0: number;
  /** Lanes end / convergence bend begins (x). */
  xConv0: number;
  /** Braid point — the strands become one (x). */
  xConv1: number;
  /** The single strand's centerline (y). */
  braidY: number;
  /** Seconds for the sweep x0 → xConv1 (the x-axis IS time). */
  beat: number;
  /** Settle targets m*, one per lane (pre-clamped by the caller if needed). */
  targets: readonly number[];
  /** Settle starts m0, one per lane. */
  starts: readonly number[];
  /** Per-lane settle time constants τ (seconds). */
  taus: readonly number[];
  /** Ripple amplitude ρ (0 disables). */
  ripple: number;
  /** Per-lane deterministic noise ξ_i(s) — pass () => 0 for a flat lane. */
  noises: readonly ((s: number) => number)[];
  /** Optional scripted transient added to lane i at time s (the science
   *  page's harmonic dip). Omit for real measurements — a scripted
   *  transient on a real capture would be a lie. */
  dip?: (laneIndex: number, s: number) => number;
  /** Weave amplitude in y units (default 4.5 — the house braid). */
  weaveAmp?: number;
}

export interface Braid {
  /** m_i(s) = m* + (m0 − m*)·e^(−s/τ) + ρ·(1−ramp)·ξ_i(s) (+ dip), clamped
   *  to [0.05, 0.98] for geometry. `settled` short-circuits to the target. */
  metric(i: number, s: number, settled: boolean): number;
  /** Lane value + convergence bend + 1¼-turn phase-offset weave. */
  strandY(i: number, s: number, settled: boolean): number;
  /** Redraw-from-0 path for strand i up to time sEnd (~220 pts at full beat). */
  strandPath(i: number, sEnd: number, settled: boolean): string;
  /** The x-axis IS time: s ∈ [0, beat] sweeps x0 → xConv1. */
  xOf(s: number): number;
}

export function makeBraid(cfg: BraidConfig): Braid {
  const {
    laneY,
    laneAmp,
    x0,
    xConv0,
    xConv1,
    braidY,
    beat,
    targets,
    starts,
    taus,
    ripple,
    noises,
    dip,
    weaveAmp = 4.5,
  } = cfg;
  const n = laneY.length;

  const xOf = (s: number): number => x0 + ((xConv1 - x0) * s) / beat;

  function metric(i: number, s: number, settled: boolean): number {
    if (settled) return targets[i];
    let m = targets[i] + (starts[i] - targets[i]) * Math.exp(-s / taus[i]);
    m += ripple * (1 - smootherstep(0, beat, s)) * noises[i](s);
    if (dip) m += dip(i, s);
    return clamp(m, 0.05, 0.98);
  }

  function strandY(i: number, s: number, settled: boolean): number {
    const x = xOf(s);
    const base = laneY[i] + (0.5 - metric(i, s, settled)) * laneAmp;
    const cv = smootherstep(xConv0, xConv1, x);
    let y = lerp(base, braidY, cv);
    if (cv > 0 && cv < 1) {
      // 1¼-turn weave, zero at both ends, phase-offset per strand → the braid.
      const u = (x - xConv0) / (xConv1 - xConv0);
      y += weaveAmp * Math.sin(Math.PI * u) * Math.sin(2.5 * Math.PI * u + (2 * Math.PI * i) / n);
    }
    return y;
  }

  function strandPath(i: number, sEnd: number, settled: boolean): string {
    const end = Math.min(sEnd, beat);
    if (end <= 0) return '';
    const pts = Math.max(2, Math.ceil((220 * end) / beat));
    let d = '';
    for (let j = 0; j <= pts; j++) {
      const s = (end * j) / pts;
      d += `${j ? 'L' : 'M'}${xOf(s).toFixed(2)} ${strandY(i, s, settled).toFixed(2)}`;
    }
    return d;
  }

  return { metric, strandY, strandPath, xOf };
}
