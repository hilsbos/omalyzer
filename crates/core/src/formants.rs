// Formant estimation (LPC pipeline) and vowel classification.
//
// Pipeline (see plan "Formants — LPC without root-finding"):
//   1. anti-alias FIR low-pass + decimate native sr -> ~12 kHz
//   2. pre-emphasis  y[n] = x[n] - 0.97 * x[n-1]
//   3. Hamming window
//   4. autocorrelation r[0..=ORDER]
//   5. Gaussian lag-window  r[k] *= exp(-0.5*(PI*k*120/fs_ds)^2)  (~60 Hz bw)
//   6. Levinson-Durbin, order 14
//   7. evaluate envelope dB on a 512-point grid 0..5 kHz
//   8. peak-pick F1/F2/F3 with harmonic-distrust heuristic
//
// All free functions on slices; no external state, std only.

use std::f32::consts::PI;

const ORDER: usize = 14;
const TARGET_FS_DS: f32 = 12_000.0; // target decimated rate (Hz)
const GRID_N: usize = 512;
const GRID_FMAX: f32 = 5_000.0;
const LAG_WIN_BW_HZ: f32 = 120.0; // controls envelope-broadening (~60 Hz bandwidth)

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Formants {
    pub f1: Option<f32>,
    pub f2: Option<f32>,
    pub f3: Option<f32>,
    /// -3 dB bandwidths (Hz) of F1/F2/F3, measured on the LPC envelope.
    /// `None` when the corresponding formant is absent or its peak cannot be
    /// located on the envelope grid.
    pub b1: Option<f32>,
    pub b2: Option<f32>,
    pub b3: Option<f32>,
}

/// Estimate the first three formants from a time-domain window at native `sr`.
///
/// `samples` is the full window at the native sample rate (e.g. 16384 samples).
/// `f0`, when known, is used only to distrust envelope peaks that land exactly
/// on a harmonic of the fundamental (a common LPC artifact at high pitch).
pub fn estimate(samples: &[f32], sr: f32, f0: Option<f32>) -> Formants {
    if samples.len() < 64 || sr <= 0.0 {
        return Formants::default();
    }

    // (1) anti-alias + decimate ----------------------------------------------
    let factor = (sr / TARGET_FS_DS).round().max(1.0) as usize;
    let fs_ds = sr / factor as f32;
    let decimated = decimate(samples, factor);
    if decimated.len() < ORDER + 2 {
        return Formants::default();
    }

    // (2) pre-emphasis --------------------------------------------------------
    let mut x = pre_emphasis(&decimated, 0.97);

    // (3) Hamming window ------------------------------------------------------
    apply_hamming(&mut x);

    // (4) autocorrelation -----------------------------------------------------
    let mut r = autocorr(&x, ORDER);
    if r[0] <= 0.0 {
        return Formants::default();
    }

    // (5) Gaussian lag-window -------------------------------------------------
    lag_window(&mut r, fs_ds, LAG_WIN_BW_HZ);

    // (6) Levinson-Durbin -----------------------------------------------------
    let a = levinson(&r, ORDER);

    // (7) evaluate LPC envelope on a 512-point grid 0..5 kHz ------------------
    let env_db = lpc_envelope_db(&a, fs_ds, GRID_N, GRID_FMAX);

    // (8) peak-pick -----------------------------------------------------------
    let grid_hz: Vec<f32> = (0..GRID_N)
        .map(|i| i as f32 * GRID_FMAX / (GRID_N - 1) as f32)
        .collect();
    let peaks = local_maxima(&env_db, &grid_hz);

    let mut formants = pick_formants(&peaks, f0);

    // -3 dB bandwidths from the same LPC envelope (None when the formant absent).
    formants.b1 = formants.f1.and_then(|f| formant_bandwidth(&env_db, &grid_hz, f));
    formants.b2 = formants.f2.and_then(|f| formant_bandwidth(&env_db, &grid_hz, f));
    formants.b3 = formants.f3.and_then(|f| formant_bandwidth(&env_db, &grid_hz, f));

    formants
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

/// Anti-alias low-pass (windowed-sinc FIR) followed by integer decimation.
///
/// Falls back to a plain copy when `factor == 1`.
fn decimate(samples: &[f32], factor: usize) -> Vec<f32> {
    if factor <= 1 {
        return samples.to_vec();
    }

    // Short windowed-sinc low-pass, cutoff = Nyquist of the decimated rate
    // (i.e. normalized cutoff fc = 0.5 / factor of the input rate).
    let taps = 8 * factor + 1; // odd length, centered
    let fc = 0.5 / factor as f32; // cycles/sample
    let mid = (taps / 2) as isize;
    let mut h = vec![0.0f32; taps];
    let mut sum = 0.0f32;
    for (i, hv) in h.iter_mut().enumerate() {
        let n = i as isize - mid;
        let sinc = if n == 0 {
            2.0 * fc
        } else {
            let x = 2.0 * PI * fc * n as f32;
            (x.sin()) / (PI * n as f32)
        };
        // Hamming window over the FIR taps.
        let w = 0.54 - 0.46 * (2.0 * PI * i as f32 / (taps - 1) as f32).cos();
        let v = sinc * w;
        *hv = v;
        sum += v;
    }
    // Normalize to unity DC gain.
    if sum != 0.0 {
        for hv in h.iter_mut() {
            *hv /= sum;
        }
    }

    // Convolve only at the kept (decimated) output positions.
    let out_len = samples.len() / factor;
    let mut out = Vec::with_capacity(out_len);
    for o in 0..out_len {
        let center = o * factor;
        let mut acc = 0.0f32;
        for (k, &hk) in h.iter().enumerate() {
            let idx = center as isize + (k as isize - mid);
            if idx >= 0 && (idx as usize) < samples.len() {
                acc += hk * samples[idx as usize];
            }
        }
        out.push(acc);
    }
    out
}

fn pre_emphasis(x: &[f32], coeff: f32) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    let mut prev = 0.0f32;
    for &v in x {
        out.push(v - coeff * prev);
        prev = v;
    }
    out
}

fn apply_hamming(x: &mut [f32]) {
    let n = x.len();
    if n < 2 {
        return;
    }
    for (i, v) in x.iter_mut().enumerate() {
        let w = 0.54 - 0.46 * (2.0 * PI * i as f32 / (n - 1) as f32).cos();
        *v *= w;
    }
}

/// Autocorrelation r[0..=order].
fn autocorr(x: &[f32], order: usize) -> Vec<f32> {
    let n = x.len();
    let mut r = vec![0.0f32; order + 1];
    for (k, rk) in r.iter_mut().enumerate() {
        let mut acc = 0.0f32;
        for i in k..n {
            acc += x[i] * x[i - k];
        }
        *rk = acc;
    }
    r
}

/// Gaussian lag-window to broaden formant bandwidths and bias the LPC fit
/// toward the spectral envelope rather than individual harmonics.
///
/// `r[k] *= exp(-0.5 * (PI * k * bw_hz / fs_ds)^2)`
fn lag_window(r: &mut [f32], fs_ds: f32, bw_hz: f32) {
    for (k, rk) in r.iter_mut().enumerate() {
        let arg = PI * k as f32 * bw_hz / fs_ds;
        *rk *= (-0.5 * arg * arg).exp();
    }
}

/// Levinson-Durbin recursion. Returns the LPC coefficients
/// `[1, a_1, ..., a_order]` such that the all-pole model is
/// `H(z) = G / (1 + a_1 z^-1 + ... + a_order z^-order)`.
///
/// Index 0 is the leading 1; `r` must have length >= order + 1.
pub(crate) fn levinson(r: &[f32], order: usize) -> Vec<f32> {
    let mut a = vec![0.0f32; order + 1];
    a[0] = 1.0;
    if r.is_empty() || r[0] == 0.0 {
        return a;
    }
    let mut err = r[0];
    for i in 1..=order {
        // reflection coefficient
        let mut acc = r[i];
        for j in 1..i {
            acc += a[j] * r[i - j];
        }
        if err.abs() < 1e-12 {
            break;
        }
        let k = -acc / err;

        // update coefficients in place using a snapshot
        let mut new_a = a.clone();
        for j in 1..i {
            new_a[j] = a[j] + k * a[i - j];
        }
        new_a[i] = k;
        a = new_a;

        err *= 1.0 - k * k;
        if err <= 0.0 {
            break;
        }
    }
    a
}

/// Evaluate the LPC spectral envelope in dB on a linear frequency grid.
///
/// envelope(f) = -20*log10(|1 + sum_{k>=1} a_k e^{-j 2 pi f k / fs}|)
fn lpc_envelope_db(a: &[f32], fs: f32, n: usize, fmax: f32) -> Vec<f32> {
    let mut out = vec![0.0f32; n];
    for (i, o) in out.iter_mut().enumerate() {
        let f = i as f32 * fmax / (n - 1) as f32;
        let w = 2.0 * PI * f / fs;
        // A(e^jw) = sum_k a_k e^{-j w k}, with a[0] = 1.
        let mut re = 0.0f32;
        let mut im = 0.0f32;
        for (k, &ak) in a.iter().enumerate() {
            let ang = -w * k as f32;
            re += ak * ang.cos();
            im += ak * ang.sin();
        }
        let mag = (re * re + im * im).sqrt().max(1e-9);
        *o = -20.0 * mag.log10();
    }
    out
}

/// Find local maxima of the envelope; returns (freq_hz, level_db) per peak,
/// with parabolic interpolation of the peak location for sub-grid accuracy.
fn local_maxima(env_db: &[f32], grid_hz: &[f32]) -> Vec<(f32, f32)> {
    let n = env_db.len();
    let mut peaks = Vec::new();
    for i in 1..n - 1 {
        if env_db[i] > env_db[i - 1] && env_db[i] >= env_db[i + 1] {
            let (yl, yc, yr) = (env_db[i - 1], env_db[i], env_db[i + 1]);
            let denom = yl - 2.0 * yc + yr;
            let delta = if denom.abs() > 1e-9 {
                0.5 * (yl - yr) / denom
            } else {
                0.0
            };
            let delta = delta.clamp(-1.0, 1.0);
            let step = grid_hz[1] - grid_hz[0];
            let f = grid_hz[i] + delta * step;
            let level = yc - 0.25 * (yl - yr) * delta;
            peaks.push((f, level));
        }
    }
    peaks
}

/// Distance (Hz) from `f` to the nearest harmonic of `f0`.
fn dist_to_harmonic(f: f32, f0: f32) -> f32 {
    if f0 <= 0.0 {
        return f32::INFINITY;
    }
    let k = (f / f0).round().max(1.0);
    (f - k * f0).abs()
}

/// Select F1/F2/F3 from candidate peaks, enforcing the range/ordering rules
/// and (when `f0` is known) distrusting a peak sitting exactly on a harmonic
/// when a broader alternative exists in range.
fn pick_formants(peaks: &[(f32, f32)], f0: Option<f32>) -> Formants {
    // ranges from the contract / plan
    let f1_range = (200.0f32, 1100.0f32);
    let f2_range = (800.0f32, 3000.0f32);
    let f3_range = (2000.0f32, 3500.0f32);

    let pick = |lo: f32, hi: f32, after: f32| -> Option<f32> {
        // collect in-range candidates above `after`
        let cands: Vec<(f32, f32)> = peaks
            .iter()
            .copied()
            .filter(|&(f, _)| f >= lo && f <= hi && f >= after)
            .collect();
        if cands.is_empty() {
            return None;
        }
        // first peak (lowest frequency) is the default choice
        let first = cands[0];

        if let Some(f0v) = f0 {
            let tol = (f0v * 0.06).max(30.0);
            // Only distrust the first candidate when it sits on a harmonic AND a
            // genuinely comparable ("broader") alternative peak exists in range.
            // An alternative only counts if it is a real formant-strength peak,
            // i.e. within ~6 dB of the candidate's level — not a noise blip far
            // down on the envelope skirt.
            if dist_to_harmonic(first.0, f0v) <= tol {
                if let Some(&alt) = cands.iter().skip(1).find(|&&(f, lvl)| {
                    dist_to_harmonic(f, f0v) > tol && lvl >= first.1 - 6.0
                }) {
                    return Some(alt.0);
                }
            }
        }
        Some(first.0)
    };

    let f1 = pick(f1_range.0, f1_range.1, 0.0);
    let after1 = f1.map(|v| v + 200.0).unwrap_or(f2_range.0);
    let f2 = pick(f2_range.0.max(after1), f2_range.1, after1);
    let after2 = f2.map(|v| v + 200.0).unwrap_or(f3_range.0);
    let f3 = pick(f3_range.0.max(after2), f3_range.1, after2);

    Formants {
        f1,
        f2,
        f3,
        ..Formants::default()
    }
}

/// Estimate the -3 dB bandwidth (Hz) of a formant peak at frequency `peak_hz`
/// on the LPC envelope (`env_db` = spectral magnitude in dB over `grid_hz`).
///
/// Snaps `peak_hz` to the nearest grid index, then walks left and right until
/// the level falls 3 dB below the peak, linearly interpolating each crossing
/// for sub-grid accuracy. The bandwidth is `right_hz - left_hz`. Returns `None`
/// for degenerate input or when neither side ever reaches the -3 dB level (e.g.
/// a peak pinned at a grid edge with no crossing in range).
fn formant_bandwidth(env_db: &[f32], grid_hz: &[f32], peak_hz: f32) -> Option<f32> {
    let n = env_db.len();
    if n < 3 || grid_hz.len() != n || !peak_hz.is_finite() {
        return None;
    }
    let step = grid_hz[1] - grid_hz[0];
    if step <= 0.0 {
        return None;
    }

    // Nearest grid index to the (parabolically-interpolated) peak frequency.
    let mut pi = ((peak_hz - grid_hz[0]) / step).round() as isize;
    pi = pi.clamp(0, (n - 1) as isize);
    let mut pi = pi as usize;

    // Refine to the local envelope maximum within +-1 bin (the peak frequency
    // was sub-grid interpolated, so the level there may sit just off the apex).
    for &j in &[pi.saturating_sub(1), (pi + 1).min(n - 1)] {
        if env_db[j] > env_db[pi] {
            pi = j;
        }
    }
    let peak_level = env_db[pi];
    let target = peak_level - 3.0;

    // Walk left until the level drops to/below target; interpolate the crossing.
    let left_hz = {
        let mut i = pi;
        let mut found = None;
        while i > 0 {
            if env_db[i - 1] <= target {
                // crossing between i-1 (below) and i (above)
                let (y0, y1) = (env_db[i - 1], env_db[i]);
                let frac = if (y1 - y0).abs() > 1e-9 {
                    (target - y0) / (y1 - y0)
                } else {
                    0.0
                };
                let frac = frac.clamp(0.0, 1.0);
                found = Some(grid_hz[i - 1] + frac * step);
                break;
            }
            i -= 1;
        }
        found
    };

    // Walk right until the level drops to/below target; interpolate the crossing.
    let right_hz = {
        let mut i = pi;
        let mut found = None;
        while i + 1 < n {
            if env_db[i + 1] <= target {
                let (y0, y1) = (env_db[i], env_db[i + 1]);
                let frac = if (y1 - y0).abs() > 1e-9 {
                    (target - y0) / (y1 - y0)
                } else {
                    0.0
                };
                let frac = frac.clamp(0.0, 1.0);
                found = Some(grid_hz[i] + frac * step);
                break;
            }
            i += 1;
        }
        found
    };

    match (left_hz, right_hz) {
        (Some(l), Some(r)) if r > l => Some(r - l),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Vowel classification
// ---------------------------------------------------------------------------

/// Nearest vowel target in log(F1)/log(F2) space.
///
/// Returns the vowel (a/e/i/o/u) and a confidence in 0..1.
pub fn classify_vowel(f1: f32, f2: f32) -> (char, f32) {
    // (vowel, F1, F2)
    const TARGETS: [(char, f32, f32); 5] = [
        ('i', 300.0, 2300.0),
        ('e', 530.0, 1850.0),
        ('a', 700.0, 1200.0),
        ('o', 500.0, 900.0),
        ('u', 350.0, 800.0),
    ];

    let lf1 = f1.max(1.0).ln();
    let lf2 = f2.max(1.0).ln();

    let mut best = ('a', f32::INFINITY);
    for &(v, tf1, tf2) in TARGETS.iter() {
        let d1 = tf1.ln() - lf1;
        let d2 = tf2.ln() - lf2;
        let dist = (d1 * d1 + d2 * d2).sqrt();
        if dist < best.1 {
            best = (v, dist);
        }
    }
    let conf = 1.0 / (1.0 + best.1 / 0.18);
    (best.0, conf)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the autocorrelation of an AR(2) process driven by white noise.
    ///
    /// For x[n] = -a1 x[n-1] - a2 x[n-2] + e[n], the theoretical
    /// autocorrelation satisfies the Yule-Walker equations. We synthesize a
    /// long signal and compute its autocorrelation, then check that Levinson
    /// recovers a1, a2.
    fn synth_ar2(a1: f32, a2: f32, n: usize) -> Vec<f32> {
        // deterministic pseudo-random excitation (LCG) so the test is stable
        let mut state: u32 = 0x1234_5678;
        let mut rng = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let mut x = vec![0.0f32; n];
        for i in 0..n {
            let e = rng();
            let x1 = if i >= 1 { x[i - 1] } else { 0.0 };
            let x2 = if i >= 2 { x[i - 2] } else { 0.0 };
            x[i] = -a1 * x1 - a2 * x2 + e;
        }
        x
    }

    #[test]
    fn levinson_recovers_ar2() {
        // Stable AR(2): poles inside unit circle.
        let a1 = -1.2f32;
        let a2 = 0.5f32;
        let x = synth_ar2(a1, a2, 200_000);
        // drop transient
        let r = autocorr(&x[1000..], 2);
        let a = levinson(&r, 2);
        // a = [1, a1, a2]
        assert!((a[1] - a1).abs() < 0.05, "a1 recovered = {} (want {})", a[1], a1);
        assert!((a[2] - a2).abs() < 0.05, "a2 recovered = {} (want {})", a[2], a2);
    }

    #[test]
    fn levinson_leading_one() {
        let r = [1.0, 0.5, 0.2, 0.1];
        let a = levinson(&r, 3);
        assert_eq!(a[0], 1.0);
        assert_eq!(a.len(), 4);
    }

    /// Synthesize a vowel as a 120 Hz harmonic complex whose harmonic
    /// amplitudes are shaped by two Gaussian envelope bumps (formants).
    fn synth_vowel(f1: f32, f2: f32, sr: f32, n: usize) -> Vec<f32> {
        let f0 = 120.0f32;
        let bw = 120.0f32; // formant bandwidth (Hz) for the Gaussian shaping
        let nharm = (sr / 2.0 / f0) as usize;
        let mut out = vec![0.0f32; n];
        for k in 1..=nharm {
            let fh = k as f32 * f0;
            if fh >= sr / 2.0 {
                break;
            }
            // amplitude = sum of two Gaussian bumps + small broadband floor
            let g1 = (-0.5 * ((fh - f1) / bw).powi(2)).exp();
            let g2 = (-0.5 * ((fh - f2) / bw).powi(2)).exp();
            let amp = (g1 + 0.85 * g2 + 0.02) / fh.sqrt(); // mild source tilt
            let phase = (k as f32) * 0.37; // arbitrary fixed phases
            for (i, o) in out.iter_mut().enumerate() {
                let t = i as f32 / sr;
                *o += amp * (2.0 * PI * fh * t + phase).cos();
            }
        }
        // normalize
        let peak = out.iter().fold(0.0f32, |m, &v| m.max(v.abs())).max(1e-9);
        for o in out.iter_mut() {
            *o /= peak;
        }
        out
    }

    #[test]
    fn estimate_vowel_a() {
        let sr = 48_000.0;
        let sig = synth_vowel(700.0, 1200.0, sr, 16384);
        let f = estimate(&sig, sr, Some(120.0));
        let f1 = f.f1.expect("F1 found");
        let f2 = f.f2.expect("F2 found");
        assert!((f1 - 700.0).abs() <= 120.0, "F1 = {} (want ~700)", f1);
        assert!((f2 - 1200.0).abs() <= 180.0, "F2 = {} (want ~1200)", f2);
        let (v, _conf) = classify_vowel(f1, f2);
        assert_eq!(v, 'a', "classified {} (F1={}, F2={})", v, f1, f2);
    }

    #[test]
    fn estimate_vowel_a_has_plausible_bandwidths() {
        let sr = 48_000.0;
        let sig = synth_vowel(700.0, 1200.0, sr, 16384);
        let f = estimate(&sig, sr, Some(120.0));
        // The two formants this vowel exposes must yield finite, plausible
        // -3 dB bandwidths (tens-to-low-hundreds of Hz for a vowel resonance).
        let b1 = f.b1.expect("B1 found");
        let b2 = f.b2.expect("B2 found");
        assert!(b1.is_finite() && b1 > 0.0, "B1 = {b1}");
        assert!(b2.is_finite() && b2 > 0.0, "B2 = {b2}");
        assert!(
            (10.0..=500.0).contains(&b1),
            "B1 = {b1} Hz out of plausible range"
        );
        assert!(
            (10.0..=500.0).contains(&b2),
            "B2 = {b2} Hz out of plausible range"
        );
    }

    #[test]
    fn estimate_vowel_i() {
        let sr = 48_000.0;
        let sig = synth_vowel(300.0, 2300.0, sr, 16384);
        let f = estimate(&sig, sr, Some(120.0));
        let f1 = f.f1.expect("F1 found");
        let f2 = f.f2.expect("F2 found");
        let (v, _conf) = classify_vowel(f1, f2);
        assert_eq!(v, 'i', "classified {} (F1={}, F2={})", v, f1, f2);
    }

    #[test]
    fn classify_targets_exact() {
        assert_eq!(classify_vowel(300.0, 2300.0).0, 'i');
        assert_eq!(classify_vowel(530.0, 1850.0).0, 'e');
        assert_eq!(classify_vowel(700.0, 1200.0).0, 'a');
        assert_eq!(classify_vowel(500.0, 900.0).0, 'o');
        assert_eq!(classify_vowel(350.0, 800.0).0, 'u');
        // exact target => high confidence
        assert!(classify_vowel(700.0, 1200.0).1 > 0.99);
    }

    #[test]
    fn classify_confidence_decreases_with_distance() {
        let near = classify_vowel(700.0, 1200.0).1;
        let far = classify_vowel(700.0, 1800.0).1;
        assert!(near > far);
        assert!((0.0..=1.0).contains(&far));
    }

    #[test]
    fn estimate_handles_short_input() {
        let f = estimate(&[0.0f32; 8], 48_000.0, None);
        assert_eq!(f, Formants::default());
    }

    #[test]
    fn decimate_reduces_length() {
        let x: Vec<f32> = (0..4096).map(|i| (i as f32 * 0.01).sin()).collect();
        let d = decimate(&x, 4);
        assert_eq!(d.len(), 1024);
    }

    #[test]
    fn lag_window_attenuates_high_lags() {
        let mut r = vec![1.0f32; 15];
        lag_window(&mut r, 12_000.0, 120.0);
        assert!((r[0] - 1.0).abs() < 1e-6);
        assert!(r[14] < r[1]);
        assert!(r[14] >= 0.0);
    }
}
