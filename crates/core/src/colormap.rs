// Magma-ish colormap for the spectrogram.

/// Magma-ish colormap, t in [0,1].
pub fn colormap(t: f32) -> [u8; 3] {
    const STOPS: [[f32; 3]; 5] = [
        [0.0, 0.0, 4.0],
        [81.0, 18.0, 124.0],
        [183.0, 55.0, 121.0],
        [252.0, 137.0, 97.0],
        [252.0, 253.0, 191.0],
    ];
    let t = t.clamp(0.0, 1.0) * 4.0;
    let i = (t as usize).min(3);
    let f = t - i as f32;
    let a = STOPS[i];
    let b = STOPS[i + 1];
    [
        (a[0] + (b[0] - a[0]) * f) as u8,
        (a[1] + (b[1] - a[1]) * f) as u8,
        (a[2] + (b[2] - a[2]) * f) as u8,
    ]
}
