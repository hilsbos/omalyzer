/* ── /science motion + signal-math utilities ────────────────────────────────
   Shared by the four set-pieces (HeroTone, VagusBridge, SourceFilter,
   FiveDimensions). Laws enforced here so builders cannot break them:
   · every rAF loop pauses off-screen (own IntersectionObserver) and never
     ticks under prefers-reduced-motion — components render the composed
     final frame themselves when `usePrefersReducedMotion()` is true;
   · all pseudo-noise is deterministic and frame-rate-independent
     (incommensurate-sine sums; NO Math.random anywhere);
   · loop time `t` accumulates only while actually running, so a paused/
     resumed animation stays continuous (required for accumulated phase). */

import { useEffect, useRef, useState, type RefObject } from 'react';

/* ════════════════════════════ reduced motion ═══════════════════════════ */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Non-hook read — internal seed for usePrefersReducedMotion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/** Live reduced-motion flag; updates if the OS setting changes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ════════════════════════════ visibility ═══════════════════════════════ */

export interface InViewOptions {
  /** true → fire once and disconnect (a beat trigger, mirrors Reveal).
   *  false (default) → re-arm on exit (pause/resume gating for rAF). */
  once?: boolean;
  /** Default '0px 0px -10% 0px' — the Reveal rootMargin, so set-piece beats
   *  land at the same scroll moment as the prose fading in around them. */
  rootMargin?: string;
  threshold?: number;
}

/** IntersectionObserver as a boolean. SSR/no-IO fallback: always true. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  opts: InViewOptions = {},
): boolean {
  const { once = false, rootMargin = '0px 0px -10% 0px', threshold = 0 } = opts;
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, once, rootMargin, threshold]);
  return inView;
}

/* ════════════════════════════ rAF loop ═════════════════════════════════ */

export interface RafLoopOptions {
  /** External gate, e.g. `enabled: revealed && !done` for one-shot beats. */
  enabled?: boolean;
  /** Visibility margin for auto-pause (default '64px' — resumes just before
   *  the element scrolls in, so the first visible frame is already moving). */
  rootMargin?: string;
}

/**
 * Drives `onFrame(t, dt)` at display rate while `ref`'s element is on-screen,
 * `enabled` is true, and the user does NOT prefer reduced motion.
 * `t` = seconds of ACTIVE animation time (freezes across pauses — keep all
 * signal math a function of this t and motion stays continuous + deterministic).
 * `dt` is clamped to 100ms so a background-tab return cannot jump the phase.
 * The latest `onFrame` closure is always used; changing it does not reset `t`.
 */
export function useRafLoop<T extends Element>(
  ref: RefObject<T | null>,
  onFrame: (t: number, dt: number) => void,
  opts: RafLoopOptions = {},
): void {
  const { enabled = true, rootMargin = '64px' } = opts;
  const inView = useInView(ref, { rootMargin, threshold: 0 });
  const reduced = usePrefersReducedMotion();
  const cbRef = useRef(onFrame);
  cbRef.current = onFrame;
  const tRef = useRef(0); // accumulated active seconds — survives pauses

  useEffect(() => {
    if (!enabled || reduced || !inView) return;
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      if (last >= 0) {
        const dt = Math.min((now - last) / 1000, 0.1);
        tRef.current += dt;
        cbRef.current(tRef.current, dt);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, reduced, inView]);
}

/* ════════════════════════════ easing ═══════════════════════════════════ */

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep, remapped over [e0, e1]. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Perlin smootherstep (C2-continuous) over [e0, e1] — the storyboard ramp. */
export function smootherstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** CSS-style cubic-bezier(x1,y1,x2,y2) as a JS unit-easing function. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const sample = (a: number, b: number, u: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  const derivative = (a: number, b: number, u: number) =>
    3 * (1 - u) * (1 - u) * a + 6 * (1 - u) * u * (b - a) + 3 * u * u * (1 - b);
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = sample(x1, x2, u) - t;
      const d = derivative(x1, x2, u);
      if (Math.abs(x) < 1e-5) break;
      if (Math.abs(d) < 1e-6) break;
      u = clamp01(u - x / d);
    }
    return sample(y1, y2, u);
  };
}

/** The house ease — cubic-bezier(0.16, 1, 0.3, 1), same as Reveal/OmLockup. */
export const easeHouse = cubicBezier(0.16, 1, 0.3, 1);

/**
 * THE cursor-blink idiom, shared by every crosshair cursor on the page: the
 * cursor parks, dips once through a smooth raised-cosine fade (opacity
 * 1 → 0 → 1 over `len` seconds, default 0.6s), and stills. One repeated
 * gesture, one hand — never a hard cut.
 */
export function blinkOpacity(t: number, start: number, len = 0.6): number {
  if (t < start || t >= start + len) return 1;
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (t - start)) / len);
}

/* ════════════════════════════ signal math ══════════════════════════════ */

const GOLDEN_FRAC = 0.6180339887498949;

/** k deterministic phases in [0, 2π) spread by the golden ratio. */
export function goldenPhases(k: number): number[] {
  const out = new Array<number>(k);
  for (let i = 0; i < k; i++) out[i] = 2 * Math.PI * (((i + 1) * GOLDEN_FRAC) % 1);
  return out;
}

/**
 * Deterministic, frame-rate-independent pseudo-noise: a 1/i-weighted sum of
 * incommensurate sinusoids, normalized to ≈[-1, 1]. Same t → same value, on
 * every visit, at any frame rate — this is the ONLY sanctioned noise source.
 * e.g. pitch wobble: makeNoise([7.3, 13.7, 23.1]); aspiration: makeNoise([310, 517, 829, 1213]).
 */
export function makeNoise(
  freqsHz: readonly number[],
  phases?: readonly number[],
): (t: number) => number {
  const n = freqsHz.length;
  const ph = phases ? phases.slice(0, n) : goldenPhases(n);
  const w = new Array<number>(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    w[i] = 1 / (i + 1);
    norm += w[i];
  }
  const omega = freqsHz.map((f) => 2 * Math.PI * f);
  return (t: number): number => {
    let y = 0;
    for (let i = 0; i < n; i++) y += w[i] * Math.sin(omega[i] * t + ph[i]);
    return y / norm;
  };
}

/** Om-like harmonic amplitudes a_k = (1/k)·e^(−k/decay), normalized to Σ=1. */
export function harmonicAmps(n = 12, decay = 8): number[] {
  const a = new Array<number>(n);
  let sum = 0;
  for (let k = 1; k <= n; k++) {
    a[k - 1] = (1 / k) * Math.exp(-k / decay);
    sum += a[k - 1];
  }
  for (let i = 0; i < n; i++) a[i] /= sum;
  return a;
}

/**
 * Additive synthesis at one instant: Σ_k a_k · sin(k·phi + ψ_k).
 * `phi` is the ACCUMULATED fundamental phase — integrate it per frame
 * (`phi += 2π·f0(t)·dt`) so a jittering f0 stays continuous. Never use f0·t.
 */
export function sumHarmonics(
  phi: number,
  amps: readonly number[],
  psis?: readonly number[],
): number {
  let y = 0;
  for (let k = 1; k <= amps.length; k++) {
    y += amps[k - 1] * Math.sin(k * phi + (psis ? psis[k - 1] : 0));
  }
  return y;
}

/** Cents offset → frequency ratio (2^(c/1200)). */
export const centsToRatio = (cents: number): number => Math.pow(2, cents / 1200);

/** Amplitude ↔ decibels. */
export const dbToLin = (db: number): number => Math.pow(10, db / 20);
export const linToDb = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));

/**
 * Two-pole formant resonator magnitude |H(f)| = F²/√((F²−f²)² + (f·B)²).
 * Unity at DC, peak ≈ F/B at resonance. Multiply resonators for a tract;
 * draw the product in dB (additions of envelopes — no tiny-number crush).
 */
export function resonatorMag(f: number, F: number, B: number): number {
  const F2 = F * F;
  const d = F2 - f * f;
  return F2 / Math.sqrt(d * d + f * f * B * B);
}

/** Weighted harmonic mean — THE Coherence Index combiner: (Σw)/(Σ w_i/v_i). */
export function weightedHarmonicMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  let sw = 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    sw += weights[i];
    s += weights[i] / Math.max(values[i], 1e-6);
  }
  return sw / s;
}

/** Weighted arithmetic mean — the "ghost" reference in set-piece IV. */
export function weightedArithmeticMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  let sw = 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    sw += weights[i];
    s += weights[i] * values[i];
  }
  return s / sw;
}
