// Magma-ish colormap, transcribed verbatim from crates/core/src/colormap.rs.
// Same 5-stop table and the same piecewise-linear interpolation.

const STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0, 0.0, 4.0],
  [81.0, 18.0, 124.0],
  [183.0, 55.0, 121.0],
  [252.0, 137.0, 97.0],
  [252.0, 253.0, 191.0],
];

/** Magma-ish colormap, `t` in [0,1] -> [r,g,b] (0..255), matching colormap.rs. */
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
