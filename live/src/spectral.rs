//! Spectral descriptors on a linear (window-normalized) magnitude spectrum.
//!
//! These operate on the kind of magnitude slice stored in `App.latest_lin`:
//! a one-sided linear-magnitude spectrum. All are pure functions on slices —
//! std-only, no external deps — so they stay unit-testable.
//!
//! - [`spectral_entropy`] — normalized Shannon entropy of the power spectrum
//!   (ordered/tonal -> low, noisy/diffuse -> high).
//! - [`spectral_flatness`] — Wiener entropy (geometric/arithmetic mean of
//!   power; tonal -> low, noise-like -> high).
//! - [`spectral_flux`] — positive-part L2 change between consecutive frames
//!   (onset / spectral-change measure).

/// Normalized Shannon spectral entropy in `0..=1`.
///
/// Treats the squared magnitudes (power) as a probability distribution and
/// computes its Shannon entropy, divided by `ln(N)` so the result is
/// length-independent. Low values indicate an ordered / tonal / coherent
/// spectrum; high values indicate a noisy / diffuse one. Returns `0.0` for
/// empty or degenerate input (a single bin, or no power).
pub fn spectral_entropy(spectrum_lin: &[f32]) -> f32 {
    let n = spectrum_lin.len();
    if n < 2 {
        return 0.0;
    }

    // Power spectrum, guarding against NaN/negative magnitudes.
    let mut total = 0.0f64;
    for &m in spectrum_lin {
        if m.is_finite() {
            let p = (m as f64) * (m as f64);
            total += p;
        }
    }
    if total <= 0.0 {
        return 0.0;
    }

    // Shannon entropy of the normalized power distribution.
    let mut entropy = 0.0f64;
    for &m in spectrum_lin {
        if !m.is_finite() {
            continue;
        }
        let p = (m as f64) * (m as f64) / total;
        if p > 0.0 {
            entropy -= p * p.ln();
        }
    }

    // Normalize by ln(N) so the result lies in 0..=1 regardless of length.
    let norm = (n as f64).ln();
    if norm <= 0.0 {
        return 0.0;
    }
    ((entropy / norm) as f32).clamp(0.0, 1.0)
}

/// Spectral flatness (Wiener entropy) in `0..=1`.
///
/// Ratio of the geometric mean to the arithmetic mean of the power spectrum.
/// Low values indicate a tonal spectrum (energy concentrated in few bins),
/// high values indicate a noise-like spectrum (energy spread evenly).
/// Returns `0.0` for empty input or when there is no usable power.
// Spec'd spectral descriptor (docs section 3.3); validated and ready to wire
// into the per-hop readout / coherence index, not yet consumed.
#[allow(dead_code)]
pub fn spectral_flatness(spectrum_lin: &[f32]) -> f32 {
    let n = spectrum_lin.len();
    if n == 0 {
        return 0.0;
    }

    // Geometric mean via the mean of the logs, arithmetic mean directly.
    // Powers are floored at a tiny epsilon so that empty/zero bins do not
    // drive the geometric mean to zero (matching the standard implementation
    // used in audio flatness estimators).
    const EPS: f64 = 1e-12;
    let mut sum_ln = 0.0f64;
    let mut sum = 0.0f64;
    let mut raw_power = 0.0f64; // un-floored power, to detect true silence
    let mut count = 0u64;
    for &m in spectrum_lin {
        if !m.is_finite() {
            continue;
        }
        let raw = (m as f64) * (m as f64);
        raw_power += raw;
        let p = raw.max(EPS);
        sum_ln += p.ln();
        sum += p;
        count += 1;
    }
    // Guard on the *un-floored* power: an all-zero (silent) spectrum has no
    // usable power and must return 0.0 as documented. Using the EPS-floored
    // `sum` here would let pure silence read as maximally flat (1.0).
    if count == 0 || raw_power <= 0.0 {
        return 0.0;
    }

    let geo = (sum_ln / count as f64).exp();
    let arith = sum / count as f64;
    if arith <= 0.0 {
        return 0.0;
    }
    ((geo / arith) as f32).clamp(0.0, 1.0)
}

/// Spectral flux between two consecutive linear magnitude spectra.
///
/// L2 norm of the positive part of `(curr - prev)`, normalized by the energy
/// of `curr` so the result is roughly `0..1` and scale-invariant. The
/// positive-part (half-wave rectified) form emphasizes spectral *onsets*
/// (energy appearing) rather than decay. Returns `0.0` if the lengths differ
/// or either spectrum is empty.
pub fn spectral_flux(prev_lin: &[f32], curr_lin: &[f32]) -> f32 {
    if prev_lin.is_empty() || curr_lin.is_empty() || prev_lin.len() != curr_lin.len() {
        return 0.0;
    }

    let mut pos_sq = 0.0f64; // sum of (positive diff)^2
    let mut energy = 0.0f64; // sum of curr^2
    for (&p, &c) in prev_lin.iter().zip(curr_lin.iter()) {
        if !p.is_finite() || !c.is_finite() {
            continue;
        }
        let d = (c - p) as f64;
        if d > 0.0 {
            pos_sq += d * d;
        }
        energy += (c as f64) * (c as f64);
    }

    if energy <= 0.0 {
        return 0.0;
    }
    // Normalize the positive-change L2 norm by the current frame's L2 norm.
    let flux = (pos_sq.sqrt() / energy.sqrt()) as f32;
    flux.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// Deterministic pseudo-random white noise in `[-1, 1)` via an LCG.
    fn white_noise(n: usize, seed: u64) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                ((s >> 33) as f32 / (1u64 << 31) as f32) - 1.0
            })
            .collect()
    }

    /// A spectrum dominated by a single tonal peak (one large bin, small floor).
    fn tonal_spectrum(n: usize, peak_bin: usize) -> Vec<f32> {
        let mut v = vec![0.001f32; n];
        if peak_bin < n {
            v[peak_bin] = 1.0;
        }
        v
    }

    #[test]
    fn pure_tone_has_low_entropy_and_flatness() {
        let spec = tonal_spectrum(256, 40);
        let h = spectral_entropy(&spec);
        let f = spectral_flatness(&spec);
        assert!(h < 0.2, "tonal entropy {h} should be low");
        assert!(f < 0.1, "tonal flatness {f} should be low");
    }

    #[test]
    fn white_noise_has_high_entropy_and_flatness() {
        // |magnitude| of white noise across bins is roughly flat/diffuse.
        let spec: Vec<f32> = white_noise(256, 0xABCD_1234).iter().map(|x| x.abs()).collect();
        let h = spectral_entropy(&spec);
        let f = spectral_flatness(&spec);
        assert!(h > 0.7, "noise entropy {h} should be high");
        // Flatness of magnitude-of-noise is moderate-to-high; clearly above tonal.
        assert!(f > 0.2, "noise flatness {f} should be well above tonal");
    }

    #[test]
    fn flat_spectrum_is_maximally_flat_and_entropic() {
        let spec = vec![0.5f32; 128];
        let h = spectral_entropy(&spec);
        let f = spectral_flatness(&spec);
        // A perfectly flat spectrum: entropy normalizes to ~1, flatness to ~1.
        assert!(h > 0.999, "flat entropy {h} should be ~1");
        assert!((f - 1.0).abs() < 1e-3, "flat flatness {f} should be ~1");
    }

    #[test]
    fn entropy_ordering_tonal_below_noise() {
        let tonal = tonal_spectrum(256, 30);
        let noise: Vec<f32> = white_noise(256, 0x9999).iter().map(|x| x.abs()).collect();
        assert!(spectral_entropy(&tonal) < spectral_entropy(&noise));
        assert!(spectral_flatness(&tonal) < spectral_flatness(&noise));
    }

    #[test]
    fn entropy_flatness_handle_degenerate_input() {
        assert_eq!(spectral_entropy(&[]), 0.0);
        assert_eq!(spectral_entropy(&[1.0]), 0.0); // single bin -> ln(1)=0 guard
        assert_eq!(spectral_entropy(&[0.0, 0.0, 0.0]), 0.0); // no power
        assert_eq!(spectral_flatness(&[]), 0.0);
        assert_eq!(spectral_flatness(&[0.0, 0.0]), 0.0); // no power
    }

    #[test]
    fn entropy_flatness_in_unit_range() {
        // Build a non-trivial spectrum from a few harmonics + noise.
        let sr = 48_000.0;
        let n = 512;
        let mut spec = vec![0.0f32; n];
        for (i, s) in spec.iter_mut().enumerate() {
            let t = i as f32;
            *s = ((2.0 * PI * t / 17.0).sin().abs()) * 0.2 + 0.01;
            let _ = sr;
        }
        let h = spectral_entropy(&spec);
        let f = spectral_flatness(&spec);
        assert!((0.0..=1.0).contains(&h), "entropy {h} out of range");
        assert!((0.0..=1.0).contains(&f), "flatness {f} out of range");
    }

    #[test]
    fn flux_zero_for_identical_spectra() {
        let spec = tonal_spectrum(128, 20);
        let flux = spectral_flux(&spec, &spec);
        assert!(flux.abs() < 1e-6, "identical-spectra flux {flux} should be ~0");
    }

    #[test]
    fn flux_positive_for_changed_spectrum() {
        let prev = tonal_spectrum(128, 20);
        let curr = tonal_spectrum(128, 60); // energy moved to a different bin
        let flux = spectral_flux(&prev, &curr);
        assert!(flux > 0.0, "changed-spectrum flux {flux} should be positive");
    }

    #[test]
    fn flux_ignores_pure_decay() {
        // curr is uniformly quieter than prev: no positive part -> flux ~0.
        let prev = vec![1.0f32; 64];
        let curr = vec![0.5f32; 64];
        let flux = spectral_flux(&prev, &curr);
        assert!(flux.abs() < 1e-6, "pure-decay flux {flux} should be ~0");
    }

    #[test]
    fn flux_scale_invariant() {
        let prev = tonal_spectrum(128, 20);
        let curr = tonal_spectrum(128, 60);
        let prev2: Vec<f32> = prev.iter().map(|x| x * 10.0).collect();
        let curr2: Vec<f32> = curr.iter().map(|x| x * 10.0).collect();
        let a = spectral_flux(&prev, &curr);
        let b = spectral_flux(&prev2, &curr2);
        assert!((a - b).abs() < 1e-4, "flux should be scale-invariant: {a} vs {b}");
    }

    #[test]
    fn flux_handles_degenerate_input() {
        assert_eq!(spectral_flux(&[], &[]), 0.0);
        assert_eq!(spectral_flux(&[1.0, 2.0], &[1.0]), 0.0); // length mismatch
        assert_eq!(spectral_flux(&[1.0], &[]), 0.0);
        assert_eq!(spectral_flux(&[0.0, 0.0], &[0.0, 0.0]), 0.0); // no energy
    }
}
