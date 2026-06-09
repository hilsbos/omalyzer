// Navy → ember → ivory colormap (web-only; the Rust desktop colormap is
// untouched). Same 5-stop table and the same piecewise-linear interpolation as
// the old magma LUT, but the endpoints are harmonized with the navy/parchment
// "darkroom-in-parchment" system: deep navy-black floor → indigo → oxblood/ember
// → terracotta-ochre → parchment-ivory. Preserves perceptual monotonic luminance.

const STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [16, 19, 31], // 0.00  deep navy-black (≈ --plate-bg)
  [44, 41, 82], // 0.25  indigo
  [134, 58, 74], // 0.50  oxblood / ember
  [205, 126, 58], // 0.75  terracotta-ochre
  [246, 240, 214], // 1.00  parchment-ivory
];

/** Navy→ember→ivory colormap, `t` in [0,1] -> [r,g,b] (0..255). */
export function colormap(t: number): [number, number, number] {
  const tc = Math.min(Math.max(t, 0), 1) * 4;
  const i = Math.min(tc | 0, 3);
  const f = tc - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    (a[0] + (b[0] - a[0]) * f) | 0,
    (a[1] + (b[1] - a[1]) * f) | 0,
    (a[2] + (b[2] - a[2]) * f) | 0,
  ];
}

/** Precompute a 256-entry RGB lookup (3 bytes/entry) for fast per-bin coloring. */
export function buildColormapLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = colormap(i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}
