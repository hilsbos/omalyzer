// Harmonic peak extraction (count / amplitudes / spectral centroid) and HNR.
//
// `analyze` operates on a linear (window-normalized) magnitude spectrum and a
// known fundamental F0. `hnr_db` measures the harmonics-to-noise ratio in the
// time domain via the Praat normalized-autocorrelation method.
//
// Pure DSP on slices: std-only, no external deps, fully unit-testable.

/// Result of harmonic analysis of a single spectral frame.
pub struct HarmonicInfo {
    /// Number of harmonics (k = 1..=20) found at least 10 dB above the noise
    /// floor.
    pub count: usize,
    /// Peak magnitudes (dB) of the first 12 harmonics, whether or not they
    /// cleared the floor. Harmonics beyond the spectrum are reported as the
    /// noise-floor level so the vector is always sized for the requested
    /// harmonics that exist.
    pub amps_db: Vec<f32>,
    /// Harmonic spectral centroid (Hz) over counted harmonics, weighted by
    /// LINEAR magnitude (the standard audio spectral centroid). Zero when no
    /// harmonic clears the floor.
    pub centroid_hz: f32,
}

/// Convert a linear magnitude to dB. Guards against log of zero / negatives.
fn lin_to_db(x: f32) -> f32 {
    20.0 * x.max(1e-12).log10()
}

/// Median of a slice (returns 0.0 for an empty slice).
fn median(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v: Vec<f32> = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// Analyze the harmonic structure of a linear magnitude spectrum given F0.
///
/// * `spectrum_lin` — linear magnitudes, already window-normalized. Index i
///   corresponds to frequency `i * bin_hz`.
/// * `bin_hz` — Hz per bin.
/// * `f0` — fundamental frequency in Hz.
pub fn analyze(spectrum_lin: &[f32], bin_hz: f32, f0: f32) -> HarmonicInfo {
    let n = spectrum_lin.len();
    if n == 0 || bin_hz <= 0.0 || !f0.is_finite() || f0 <= 0.0 {
        return HarmonicInfo {
            count: 0,
            amps_db: Vec::new(),
            centroid_hz: 0.0,
        };
    }

    // Noise floor: median of the linear spectrum over 0..min(len, 5kHz/bin_hz),
    // converted to dB.
    let floor_hi = ((5000.0 / bin_hz).floor() as usize).min(n).max(1);
    let floor_lin = median(&spectrum_lin[0..floor_hi]);
    let floor_db = lin_to_db(floor_lin);

    let mut count = 0usize;
    let mut amps_db: Vec<f32> = Vec::with_capacity(12);
    let mut centroid_num = 0.0f64; // sum(freq * a_k), magnitude-weighted
    let mut centroid_den = 0.0f64; // sum(a_k)

    for k in 1..=20usize {
        let expected = (k as f32) * f0 / bin_hz; // expected bin (fractional)
        let center = expected.round() as isize;

        // Search ±3 bins for a local maximum magnitude.
        let lo = (center - 3).max(0);
        let hi = (center + 3).min(n as isize - 1);
        if hi < lo {
            // This harmonic is entirely beyond the spectrum: record floor and
            // stop accumulating amps once we leave the first-12 window.
            if amps_db.len() < 12 {
                amps_db.push(floor_db);
            }
            continue;
        }

        // Find the strongest *local maximum* (a bin greater than both of its
        // neighbours) within the window. A genuine harmonic forms a true peak;
        // the monotonic spectral-leakage skirt of an adjacent strong tone does
        // not, so this rejects leakage that would otherwise be miscounted as a
        // harmonic. Fall back to the largest bin if no local max exists.
        let mut peak_bin = lo;
        let mut peak_mag = spectrum_lin[lo as usize];
        let mut best_local: Option<(isize, f32)> = None;
        let mut b = lo;
        while b <= hi {
            let m = spectrum_lin[b as usize];
            if m > peak_mag {
                peak_mag = m;
                peak_bin = b;
            }
            let is_local_max = b > 0
                && (b as usize) < n - 1
                && m >= spectrum_lin[(b - 1) as usize]
                && m >= spectrum_lin[(b + 1) as usize];
            if is_local_max && best_local.map_or(true, |(_, bm)| m > bm) {
                best_local = Some((b, m));
            }
            b += 1;
        }
        // Was a true peak found near this harmonic? Only such bins are counted.
        let is_harmonic_peak = best_local.is_some();
        if let Some((lb, lm)) = best_local {
            peak_bin = lb;
            peak_mag = lm;
        }

        // Parabolic interpolation of the peak magnitude using the three points
        // around peak_bin (only when interior neighbours exist).
        let (interp_mag, interp_bin) = if peak_bin > 0 && (peak_bin as usize) < n - 1 {
            let y0 = spectrum_lin[(peak_bin - 1) as usize];
            let y1 = spectrum_lin[peak_bin as usize];
            let y2 = spectrum_lin[(peak_bin + 1) as usize];
            let denom = y0 - 2.0 * y1 + y2;
            if denom.abs() > 1e-20 {
                let delta = 0.5 * (y0 - y2) / denom; // in (-1, 1)
                let mag = y1 - 0.25 * (y0 - y2) * delta;
                (mag.max(0.0), peak_bin as f32 + delta)
            } else {
                (y1, peak_bin as f32)
            }
        } else {
            (peak_mag, peak_bin as f32)
        };

        let peak_db = lin_to_db(interp_mag);

        if amps_db.len() < 12 {
            amps_db.push(peak_db);
        }

        // Counted only if it is a genuine local-max peak (not a leakage skirt)
        // and at least 10 dB above the noise floor.
        if is_harmonic_peak && peak_db - floor_db >= 10.0 {
            count += 1;
            let freq = interp_bin * bin_hz; // refined harmonic frequency
            centroid_num += (freq as f64) * (interp_mag as f64);
            centroid_den += interp_mag as f64;
        }
    }

    let centroid_hz = if centroid_den > 0.0 {
        (centroid_num / centroid_den) as f32
    } else {
        0.0
    };

    HarmonicInfo {
        count,
        amps_db,
        centroid_hz,
    }
}

/// Harmonics-to-noise ratio in dB (Praat method) from time-domain samples.
///
/// Normalized autocorrelation `r(tau) = sum(x[i]x[i+tau]) /
/// sqrt(sum(x[i]^2) * sum(x[i+tau]^2))` evaluated at the pitch lag
/// `tau = round(sr/f0)`, with parabolic refinement over `tau-1..tau+1`.
/// `HNR = 10*log10(r/(1-r))`.
///
/// Uses the most recent 2048 samples when given more.
pub fn hnr_db(samples: &[f32], sr: f32, f0: f32) -> f32 {
    if samples.is_empty() || !sr.is_finite() || sr <= 0.0 || !f0.is_finite() || f0 <= 0.0 {
        return f32::NEG_INFINITY;
    }

    // Use the most recent 2048 samples.
    let start = samples.len().saturating_sub(2048);
    let x = &samples[start..];
    let n = x.len();

    let tau0 = (sr / f0).round() as isize;
    if tau0 < 1 || (tau0 as usize) >= n {
        return f32::NEG_INFINITY;
    }

    // Normalized autocorrelation at a given lag.
    let norm_acf = |tau: isize| -> f32 {
        if tau < 0 || (tau as usize) >= n {
            return 0.0;
        }
        let t = tau as usize;
        let len = n - t;
        let mut num = 0.0f64;
        let mut e0 = 0.0f64;
        let mut et = 0.0f64;
        for i in 0..len {
            let a = x[i] as f64;
            let b = x[i + t] as f64;
            num += a * b;
            e0 += a * a;
            et += b * b;
        }
        let den = (e0 * et).sqrt();
        if den <= 1e-20 {
            0.0
        } else {
            (num / den) as f32
        }
    };

    // Parabolic refinement of the peak around tau0 using r(tau-1..tau+1).
    let rm = norm_acf(tau0 - 1);
    let r0 = norm_acf(tau0);
    let rp = norm_acf(tau0 + 1);

    let denom = rm - 2.0 * r0 + rp;
    let r = if denom.abs() > 1e-20 {
        let delta = 0.5 * (rm - rp) / denom;
        // Interpolated peak value.
        let peak = r0 - 0.25 * (rm - rp) * delta;
        // Only trust the refined value if it improves on the sample and the
        // offset is within one bin; otherwise fall back to r0.
        if delta.abs() <= 1.0 && peak >= r0 {
            peak
        } else {
            r0
        }
    } else {
        r0
    };

    // Clamp r off the asymptotes of HNR = 10*log10(r/(1-r)). The upper bound
    // 1 - 1e-7 caps the reportable HNR at ~70 dB (well above any real voice),
    // so clean tones are not artificially flattened to a low ceiling.
    let r = r.clamp(1e-6, 1.0 - 1e-7);
    10.0 * (r / (1.0 - r)).log10()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// Compute a one-sided linear magnitude spectrum of a real signal via a
    /// naive DFT. `n_bins` covers 0..=Nyquist-ish; we only need low-frequency
    /// accuracy for these tests so a direct DFT on a modest window is fine.
    fn dft_magnitude(signal: &[f32], n_freq: usize) -> Vec<f32> {
        let n = signal.len();
        let mut out = vec![0.0f32; n_freq];
        for (k, slot) in out.iter_mut().enumerate() {
            let mut re = 0.0f64;
            let mut im = 0.0f64;
            let w = -2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
            for (i, &s) in signal.iter().enumerate() {
                let ph = w * (i as f64);
                re += (s as f64) * ph.cos();
                im += (s as f64) * ph.sin();
            }
            // Window-normalize so a unit-amplitude bin reads ~1.0.
            *slot = ((re * re + im * im).sqrt() / (n as f64 / 2.0)) as f32;
        }
        out
    }

    fn sawtooth(f0: f32, sr: f32, n: usize, n_harm: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; n];
        for (i, s) in out.iter_mut().enumerate() {
            let t = i as f32 / sr;
            let mut v = 0.0f32;
            for k in 1..=n_harm {
                v += (2.0 * PI * (k as f32) * f0 * t).sin() / (k as f32);
            }
            *s = v;
        }
        out
    }

    fn sine(f0: f32, sr: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * PI * f0 * (i as f32) / sr).sin())
            .collect()
    }

    #[test]
    fn sawtooth_has_many_harmonics_and_high_centroid() {
        let sr = 48_000.0;
        let f0 = 150.0;
        let n = 4096;
        let sig = sawtooth(f0, sr, n, 30);

        let bin_hz = sr / n as f32;
        // Cover up to ~6 kHz so 20 harmonics of 150 Hz (=3 kHz) are present.
        let n_freq = (6000.0 / bin_hz) as usize;
        let spec = dft_magnitude(&sig, n_freq);

        let info = analyze(&spec, bin_hz, f0);
        assert!(
            info.count >= 10,
            "expected >=10 harmonics, got {}",
            info.count
        );
        assert!(
            info.centroid_hz > 150.0 * 3.0,
            "centroid {} should be well above f0",
            info.centroid_hz
        );
        assert_eq!(info.amps_db.len(), 12, "first-12 amps reported");
    }

    #[test]
    fn pure_sine_has_single_harmonic() {
        let sr = 48_000.0;
        let f0 = 200.0;
        let n = 4096;
        let sig = sine(f0, sr, n);

        let bin_hz = sr / n as f32;
        let n_freq = (6000.0 / bin_hz) as usize;
        let spec = dft_magnitude(&sig, n_freq);

        let info = analyze(&spec, bin_hz, f0);
        assert_eq!(info.count, 1, "pure sine has exactly one harmonic");
        assert!(
            (info.centroid_hz - f0).abs() < bin_hz * 2.0,
            "centroid {} should be near f0 {}",
            info.centroid_hz,
            f0
        );
    }

    #[test]
    fn analyze_handles_short_spectrum_gracefully() {
        // f0 large enough that harmonics fall beyond the spectrum length.
        let spec = vec![0.001f32; 10];
        let info = analyze(&spec, 50.0, 400.0);
        // Should not panic; counts may be zero, amps padded with floor.
        assert!(info.count <= 1);
        assert!(info.amps_db.len() <= 12);
    }

    #[test]
    fn analyze_rejects_invalid_input() {
        let info = analyze(&[], 50.0, 150.0);
        assert_eq!(info.count, 0);
        let info = analyze(&[1.0, 2.0], 50.0, 0.0);
        assert_eq!(info.count, 0);
    }

    #[test]
    fn sine_has_high_hnr() {
        let sr = 48_000.0;
        let f0 = 200.0;
        let sig = sine(f0, sr, 2048);
        let hnr = hnr_db(&sig, sr, f0);
        assert!(hnr > 30.0, "pure sine HNR {} should exceed 30 dB", hnr);
    }

    #[test]
    fn sine_plus_noise_has_low_hnr() {
        let sr = 48_000.0;
        let f0 = 200.0;
        let n = 2048;
        // Deterministic pseudo-random white noise (LCG) so the test is stable.
        let mut seed: u64 = 0x1234_5678_9abc_def0;
        let mut noise = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) as f32 / (1u64 << 31) as f32) - 1.0 // ~[-1,1)
        };
        let sig: Vec<f32> = (0..n)
            .map(|i| {
                let s = (2.0 * PI * f0 * (i as f32) / sr).sin();
                // Strong noise: amplitude comparable to / larger than signal.
                s * 0.3 + noise() * 2.0
            })
            .collect();
        let hnr = hnr_db(&sig, sr, f0);
        assert!(
            hnr < 10.0,
            "noisy sine HNR {} should be below 10 dB",
            hnr
        );
    }

    #[test]
    fn hnr_uses_last_2048_samples() {
        let sr = 48_000.0;
        let f0 = 200.0;
        // 4096 samples; only the last 2048 should be used.
        let sig = sine(f0, sr, 4096);
        let hnr = hnr_db(&sig, sr, f0);
        assert!(hnr > 30.0, "windowed sine HNR {} should exceed 30 dB", hnr);
    }

    #[test]
    fn hnr_rejects_invalid_input() {
        assert_eq!(hnr_db(&[], 48_000.0, 200.0), f32::NEG_INFINITY);
        assert_eq!(hnr_db(&[1.0; 100], 48_000.0, 0.0), f32::NEG_INFINITY);
    }
}
