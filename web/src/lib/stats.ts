// stats.ts — shared sort-based order statistics.
//
// median() is the exact math CommunityCompare has used since launch, lifted
// here so the signature plate's p25/p75 and the panel's median are one
// implementation by construction. quantile() extends it with the standard
// linear-interpolation estimator (R-7), which agrees with median() at p = 0.5.

/** Median of a numeric array, or null if empty. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Linear-interpolation quantile (R-7 / Excel / NumPy default), p in [0, 1].
 * Returns null on an empty array. quantile(xs, 0.5) === median(xs).
 */
export function quantile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return frac === 0 ? s[lo] : s[lo] + frac * (s[lo + 1] - s[lo]);
}

/** Sample standard deviation (n − 1 denominator), 0 for n < 2. */
export function sampleStd(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= n;
  let ss = 0;
  for (const x of xs) ss += (x - mean) * (x - mean);
  return Math.sqrt(ss / (n - 1));
}
