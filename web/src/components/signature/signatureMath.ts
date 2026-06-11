/* ── signatureMath — pure derivations for the signature plate ───────────────
   Every number here is computed from the user's own RLS-scoped OmRow[]
   (the existing fetchMyOms select — id, created_at, vowel, duration_secs,
   coherence_index; nothing widened, no second query, no backend objects).

   The honesty rules these functions enforce:
   · null/non-finite coherence rows COUNT toward coverage (a hold is a hold)
     but never plot — every plotted layer filters Number.isFinite first;
   · M = 12 holds is where a per-sound distribution becomes DRAWABLE
     (median + interquartile band stop being dominated by single outliers) —
     it is written "~12" everywhere and nothing ever "completes";
   · two visible sharpening ingredients, two phases: ink saturation tracks
     n/12 while the curve is forming; day-spread drives band/curve clarity
     once it is sharpening (full clarity ≈ two weeks of distinct days,
     echoing the research's "2–4 weeks of normal sessions" anchor §7.3);
   · the KDE is suppressed below n = 5 — at 3–4 holds only strikes and the
     median/IQR print, and the IQR *outline* first appears at ~12 SCORED
     holds (the structural unlock: the curve holds its shape). Coverage —
     phase, dots, count line — keeps counting every hold, but the outline is
     a claim about the drawn band, so it waits for nFinite ≥ ~12: a band
     backed by three points never earns its outline just because unscored
     holds moved the counter past twelve. */

import type { OmRow } from '../../lib/oms';
import { median, quantile, sampleStd } from '../../lib/stats';

/** Holds per sound at which the distribution becomes drawable. Always "~12". */
export const M_HOLDS = 12;

/** The classifier's full vowel vocabulary (core's classify_vowel). */
export const VOWELS = ['a', 'e', 'i', 'o', 'u'] as const;

/** Sentinel bucket key for rows whose vowel is null/unrecognized. */
export const UNCLASSIFIED = '—';

export type StripPhase = 'unwritten' | 'first-marks' | 'forming' | 'sharpening';

/** One plotted strike: a finite-coherence hold. */
export interface StripMark {
  /** created_at as epoch ms (chronological sort key). */
  t: number;
  /** ISO created_at, for tooltips. */
  iso: string;
  /** Coherence index, finite, clamped to [0, 1] for geometry only. */
  c: number;
  /** True for the single newest finite-coherence om across the whole plate. */
  latest: boolean;
  /** Global oldest→newest print order across all strips (motion delay). */
  order: number;
}

/** Per-element ink opacities — the two sharpening channels made literal. */
export interface StripInk {
  mark: number; //    strikes
  band: number; //    IQR band fill
  medianLine: number;
  curve: number; //   KDE stroke
  outline: number; // IQR outline stroke (0 below ~12)
}

export interface StripStats {
  /** 'a' | 'e' | 'i' | 'o' | 'u' | UNCLASSIFIED */
  key: string;
  /** Display glyph: "/a/" (or "—" for the unclassified bucket). */
  glyph: string;
  /** All saved holds for this sound — coverage (dot meter, count line). */
  nHolds: number;
  /** Holds with a finite coherence index — everything drawable. */
  nFinite: number;
  /** Distinct local calendar days among finite holds. */
  distinctDays: number;
  phase: StripPhase;
  /** Gutter count line, exact locked vocabulary. */
  countLine: string;
  marks: StripMark[];
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Normalized KDE (peak = 1) sampled over [0,1]; null below n = 5. */
  curve: Array<{ x: number; y: number }> | null;
  ink: StripInk;
}

export interface PlateTotals {
  oms: number;
  distinctDays: number;
  /** Σ duration_secs over rows where it is finite, rounded. */
  secondsHeld: number;
}

export interface LatestFact {
  /** The newest finite-coherence om's index. */
  coherence: number;
  /** Median across ALL finite holds (the plate is the all scope). */
  yourMedian: number;
  /** True when the newest om is < 24 h old — the only time the fact prints. */
  fresh: boolean;
  vowelKey: string;
  iso: string;
}

export interface SignatureModel {
  totals: PlateTotals;
  /** Five vowel strips, plus an UNCLASSIFIED strip only if such rows exist. */
  strips: StripStats[];
  latest: LatestFact | null;
  /** Total plotted marks across all strips (motion-budget divisor). */
  markCount: number;
}

/* ════════════════════════════ small pieces ═════════════════════════════ */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Local calendar-day key for a timestamptz ISO string. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Count of distinct local calendar days across rows. */
export function distinctDayCount(isos: readonly string[]): number {
  return new Set(isos.map(localDayKey)).size;
}

/** Phase ladder over scored coverage — two named phases, never a third. */
export function phaseOf(nHolds: number): StripPhase {
  if (nHolds === 0) return 'unwritten';
  if (nHolds <= 2) return 'first-marks';
  if (nHolds < M_HOLDS) return 'forming';
  return 'sharpening';
}

/** Locked gutter vocabulary. The tilde in "~12" is load-bearing. */
export function countLineOf(phase: StripPhase, nHolds: number): string {
  switch (phase) {
    case 'unwritten':
      return `unwritten · 0 of ~${M_HOLDS}`;
    case 'first-marks':
      return `first marks · ${nHolds} of ~${M_HOLDS}`;
    case 'forming':
      return `forming · ${nHolds} of ~${M_HOLDS}`;
    case 'sharpening':
      return `${nHolds} held · sharpening`;
  }
}

/**
 * Forming channel: ink saturation rises with n/12 — below ~12 the day-spread
 * signal is mostly degenerate, so the visible ingredient is simply how many
 * marks the page holds.
 */
export function inkSaturation(nFinite: number): number {
  return clamp01(nFinite / M_HOLDS);
}

/**
 * Sharpening channel: s = clamp01((distinctDays − 2) / 12) — band and curve
 * clarity ramp with days apart, reaching full clarity around two weeks of
 * distinct days (inside the research's 2–4-week anchor, never quoted as a
 * promise).
 */
export function daySpreadSharpness(days: number): number {
  return clamp01((days - 2) / 12);
}

/** The two channels composed into per-layer opacities. The IQR outline is
 *  the one layer gated on SCORED holds (nFinite ≥ ~12), not coverage: it is
 *  drawn from the finite values, so it unlocks only when they can carry it. */
export function stripInk(phase: StripPhase, nFinite: number, days: number): StripInk {
  const k = inkSaturation(nFinite);
  if (phase === 'sharpening') {
    const s = daySpreadSharpness(days);
    return {
      mark: 0.9,
      band: lerp(0.1, 0.2, s),
      medianLine: lerp(0.5, 0.9, s),
      curve: lerp(0.5, 0.95, s),
      outline: nFinite >= M_HOLDS ? lerp(0.3, 0.7, s) : 0,
    };
  }
  return {
    mark: lerp(0.45, 0.9, k),
    band: lerp(0.06, 0.14, k),
    medianLine: lerp(0.35, 0.6, k),
    curve: lerp(0.3, 0.6, k),
    outline: 0, // the IQR outline first appears at ~12 scored — the structural unlock
  };
}

/* ════════════════════════════ KDE ══════════════════════════════════════ */

/** Bandwidth floor — a 0–1 bounded index never earns sub-0.04 precision. */
export const KDE_BANDWIDTH_FLOOR = 0.04;
/** KDE suppressed below this n; 3–4 holds show strikes + median/IQR only. */
export const KDE_MIN_N = 5;
const KDE_POINTS = 65;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/**
 * Silverman's rule with a floor:
 *   h = max(0.9 · min(σ, IQR/1.34) · n^(−1/5), 0.04)
 * Degenerate spreads (identical values) fall to the floor instead of zero.
 */
export function silvermanBandwidth(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return KDE_BANDWIDTH_FLOOR;
  const sigma = sampleStd(xs);
  const p25 = quantile(xs, 0.25);
  const p75 = quantile(xs, 0.75);
  const iqr = p25 != null && p75 != null ? p75 - p25 : 0;
  const spreads = [sigma, iqr / 1.34].filter((v) => v > 0);
  if (!spreads.length) return KDE_BANDWIDTH_FLOOR;
  const h = 0.9 * Math.min(...spreads) * Math.pow(n, -0.2);
  return Math.max(h, KDE_BANDWIDTH_FLOOR);
}

/**
 * Gaussian KDE on the bounded support [0, 1] with boundary reflection
 * (each sample mirrored about 0 and 1 so no mass leaks off the index's
 * domain), sampled at 65 points and normalized to peak = 1 for drawing.
 * Returns null below KDE_MIN_N.
 */
export function kdeCurve(xs: readonly number[]): Array<{ x: number; y: number }> | null {
  if (xs.length < KDE_MIN_N) return null;
  const h = silvermanBandwidth(xs);
  const pts: Array<{ x: number; y: number }> = new Array(KDE_POINTS);
  let peak = 0;
  for (let i = 0; i < KDE_POINTS; i++) {
    const x = i / (KDE_POINTS - 1);
    let d = 0;
    for (const xi of xs) {
      for (const m of [xi, -xi, 2 - xi]) {
        const u = (x - m) / h;
        d += INV_SQRT_2PI * Math.exp(-0.5 * u * u);
      }
    }
    d /= xs.length * h;
    pts[i] = { x, y: d };
    if (d > peak) peak = d;
  }
  if (peak > 0) for (const p of pts) p.y /= peak;
  return pts;
}

/* ════════════════════════════ the model ════════════════════════════════ */

const FRESH_MS = 24 * 60 * 60 * 1000;

/** Bucket key for a row's vowel. */
export function vowelKeyOf(vowel: string | null): string {
  return vowel && (VOWELS as readonly string[]).includes(vowel) ? vowel : UNCLASSIFIED;
}

/**
 * The whole plate from one pass over the rows fetchMyOms already returns
 * (newest-first; order here is re-derived, not assumed).
 */
export function computeSignature(oms: readonly OmRow[], now: number = Date.now()): SignatureModel {
  // Totals — coverage counts every hold; seconds sum finite durations only.
  let secondsHeld = 0;
  for (const o of oms) {
    if (o.duration_secs != null && Number.isFinite(o.duration_secs)) secondsHeld += o.duration_secs;
  }
  const totals: PlateTotals = {
    oms: oms.length,
    distinctDays: distinctDayCount(oms.map((o) => o.created_at)),
    secondsHeld: Math.round(secondsHeld),
  };

  // Finite-coherence rows, oldest → newest: global print order + latest mark.
  const finite = oms
    .filter((o) => o.coherence_index != null && Number.isFinite(o.coherence_index))
    .map((o) => ({
      key: vowelKeyOf(o.vowel),
      t: new Date(o.created_at).getTime(),
      iso: o.created_at,
      c: clamp01(o.coherence_index as number),
    }))
    .sort((a, b) => a.t - b.t);

  const newest = finite.length ? finite[finite.length - 1] : null;
  const allFinite = finite.map((f) => f.c);
  const yourMedian = median(allFinite);
  const latest: LatestFact | null =
    newest && yourMedian != null
      ? {
          coherence: newest.c,
          yourMedian,
          fresh: now - newest.t < FRESH_MS,
          vowelKey: newest.key,
          iso: newest.iso,
        }
      : null;

  // Strips: the five vowels always; the unclassified bucket only if it exists.
  const keys: string[] = [...VOWELS];
  if (oms.some((o) => vowelKeyOf(o.vowel) === UNCLASSIFIED)) keys.push(UNCLASSIFIED);

  const strips = keys.map((key): StripStats => {
    const holds = oms.filter((o) => vowelKeyOf(o.vowel) === key);
    const mine = finite.filter((f) => f.key === key);
    const values = mine.map((m) => m.c);
    const nFinite = values.length;
    const days = distinctDayCount(mine.map((m) => m.iso));
    const phase = phaseOf(holds.length);
    const ink = stripInk(phase, nFinite, days);
    return {
      key,
      glyph: key === UNCLASSIFIED ? UNCLASSIFIED : `/${key}/`,
      nHolds: holds.length,
      nFinite,
      distinctDays: days,
      phase,
      countLine: countLineOf(phase, holds.length),
      marks: mine.map((m) => ({
        t: m.t,
        iso: m.iso,
        c: m.c,
        latest: m === newest, // object identity — exactly one latest mark
        order: finite.indexOf(m),
      })),
      median: median(values),
      // Median + IQR print from 3 holds; the OUTLINE waits for ~12 scored (stripInk).
      p25: nFinite >= 3 ? quantile(values, 0.25) : null,
      p75: nFinite >= 3 ? quantile(values, 0.75) : null,
      curve: kdeCurve(values),
      ink,
    };
  });

  return { totals, strips, latest, markCount: finite.length };
}

/* ════════════════════════════ motion budget ════════════════════════════ */

/**
 * Print-then-stillness: marks appear oldest → newest, the whole printing
 * always finishing inside ~2 s (≤ 2.4 s with the 0.3 s per-mark transition);
 * per-mark delay = order · min(40 ms, 2 s / total).
 */
export function printDelaySeconds(order: number, total: number): number {
  if (total <= 0) return 0;
  return order * Math.min(0.04, 2.0 / total);
}

/** Layers (band/median/curve) fade in after the last strike has printed. */
export function layerDelaySeconds(total: number): number {
  return total > 0 ? printDelaySeconds(total - 1, total) + 0.2 : 0;
}
