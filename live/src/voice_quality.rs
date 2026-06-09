//! Voice-quality measures: shimmer, CPP, and H1-H2.
//!
//! These are perturbation / tension descriptors that complement pitch, HNR and
//! harmonic analysis. The literature treats shimmer, HNR and CPP as
//! "perturbation"/"voicing" features and H1-H2 as a "tension/breathiness"
//! indicator (see docs section 3.2).
//!
//! Pure DSP on slices: std-only, no external deps, fully unit-testable.

/// Convert a linear magnitude to dB. Guards against log of zero / negatives.
#[allow(dead_code)] // helper for cpp(); part of the spec'd voice-quality toolbox
fn lin_to_db(x: f32) -> f32 {
    20.0 * x.max(1e-12).log10()
}

/// Mean of a slice (returns 0.0 for an empty slice).
fn mean(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f32>() / values.len() as f32
}

/// Shimmer: mean absolute cycle-to-cycle relative amplitude variation over a
/// voiced segment.
///
/// One pitch period spans `period = round(sr/f0)` samples. We slice the most
/// recent samples into consecutive periods, take the peak (max |sample|)
/// amplitude of each period, and return `mean(|A[k+1]-A[k]|) / mean(A)`. This
/// is the standard relative shimmer; typical healthy voice is ~0.02..0.10.
///
/// Returns `None` if the input is degenerate or contains too few periods
/// (< 3 peaks → < 2 cycle-to-cycle differences).
pub fn shimmer(samples: &[f32], sr: f32, f0: f32) -> Option<f32> {
    if samples.is_empty() || !sr.is_finite() || sr <= 0.0 || !f0.is_finite() || f0 <= 0.0 {
        return None;
    }

    let period = (sr / f0).round() as usize;
    if period == 0 {
        return None;
    }

    // Use the most recent whole periods. Cap at ~2048 samples to bound work and
    // mirror the windowing convention used elsewhere (e.g. hnr_db).
    let max_samples = samples.len().min(2048);
    let start = samples.len() - max_samples;
    let x = &samples[start..];

    let n_periods = x.len() / period;
    if n_periods < 3 {
        return None;
    }

    // Per-period peak amplitude (max absolute sample within the period).
    let mut peaks: Vec<f32> = Vec::with_capacity(n_periods);
    for k in 0..n_periods {
        let lo = k * period;
        let hi = lo + period;
        let mut peak = 0.0f32;
        for &s in &x[lo..hi] {
            let a = s.abs();
            if a > peak {
                peak = a;
            }
        }
        peaks.push(peak);
    }

    let amp_mean = mean(&peaks);
    if amp_mean <= 1e-12 {
        return None;
    }

    let mut diff_sum = 0.0f32;
    for w in peaks.windows(2) {
        diff_sum += (w[1] - w[0]).abs();
    }
    let diff_mean = diff_sum / (peaks.len() - 1) as f32;

    let s = diff_mean / amp_mean;
    if s.is_finite() {
        Some(s)
    } else {
        None
    }
}

/// CPP (cepstral peak prominence) in dB.
///
/// Computes the real cepstrum of the windowed (Hann) segment, locates the
/// rahmonic peak in the quefrency band corresponding to f0 (search ±20% around
/// `sr/f0`), and reports its prominence in dB above the linear-regression
/// baseline of the cepstrum. Higher = clearer / more periodic voice.
///
/// Following the Hillenbrand definition, the regression baseline is fit over a
/// *wide* quefrency range (from ~1 ms up to the Nyquist quefrency), not just the
/// narrow peak-search band — so the baseline represents the aperiodic cepstral
/// floor and the lone rahmonic peak does not pull it upward. (This is CPP, not
/// CPPS: there is no time/quefrency smoothing of the cepstrum.)
///
/// Returns `None` if the input is too short to resolve the expected quefrency or
/// the input is degenerate.
// Spec'd voice-quality feature (docs section 3.1); validated and ready to wire
// into the per-hop readout / coherence index, not yet consumed.
#[allow(dead_code)]
pub fn cpp(samples: &[f32], sr: f32, f0: f32) -> Option<f32> {
    if samples.is_empty() || !sr.is_finite() || sr <= 0.0 || !f0.is_finite() || f0 <= 0.0 {
        return None;
    }

    // Use the most recent (up to) 2048 samples.
    let max_samples = samples.len().min(2048);
    let start = samples.len() - max_samples;
    let x = &samples[start..];
    let n = x.len();
    if n < 64 {
        return None;
    }

    // Expected quefrency (in samples) of the rahmonic peak and the ±20% band.
    let q0 = sr / f0;
    let q_lo = (q0 * 0.8).floor() as usize;
    let q_hi = (q0 * 1.2).ceil() as usize;
    // Quefrency 0 is the DC term; require a usable band strictly inside the
    // cepstrum (which has n/2+1 unique points for a real cepstrum).
    let q_lo = q_lo.max(1);
    let max_q = n / 2;
    if q_lo < 1 || q_hi >= max_q || q_lo >= q_hi {
        return None;
    }

    // Hann window the segment to suppress edge leakage before the log spectrum.
    let windowed: Vec<f32> = (0..n)
        .map(|i| {
            let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n as f32 - 1.0)).cos();
            x[i] * w
        })
        .collect();

    // Real cepstrum: c[q] = IDFT( log|DFT(x)| ). We use a naive DFT/IDFT in the
    // style of the harmonics.rs test helpers — std-only and correct over the
    // band of interest. The cepstrum of a real, even log-magnitude spectrum is
    // real and even, so a cosine transform suffices.
    let cep = real_cepstrum(&windowed);
    if cep.len() <= q_hi {
        return None;
    }

    // Find the peak (max) cepstral value in the search band.
    let mut peak_q = q_lo;
    let mut peak_val = cep[q_lo];
    for q in q_lo..=q_hi {
        if cep[q] > peak_val {
            peak_val = cep[q];
            peak_q = q;
        }
    }

    // Linear-regression baseline over a WIDE quefrency range (Hillenbrand CPP):
    // from ~1 ms (excluding the very-low-quefrency spectral-envelope/formant
    // region) up to the Nyquist quefrency. Spanning the whole rahmonic region
    // means the single peak barely shifts the fit, so the baseline tracks the
    // aperiodic floor — the defined quantity. Fit val = a + b*q by least squares.
    let baseline_lo = ((sr * 0.001).round() as usize).max(1);
    let baseline_hi = max_q.saturating_sub(1);
    if baseline_lo >= baseline_hi || cep.len() <= baseline_hi {
        return None;
    }
    let band: Vec<(f32, f32)> = (baseline_lo..=baseline_hi)
        .map(|q| (q as f32, cep[q]))
        .collect();
    let m = band.len() as f32;
    let sum_x: f32 = band.iter().map(|(qx, _)| *qx).sum();
    let sum_y: f32 = band.iter().map(|(_, qy)| *qy).sum();
    let sum_xx: f32 = band.iter().map(|(qx, _)| qx * qx).sum();
    let sum_xy: f32 = band.iter().map(|(qx, qy)| qx * qy).sum();
    let denom = m * sum_xx - sum_x * sum_x;
    let (a, b) = if denom.abs() > 1e-12 {
        let b = (m * sum_xy - sum_x * sum_y) / denom;
        let a = (sum_y - b * sum_x) / m;
        (a, b)
    } else {
        // Degenerate band: fall back to a flat baseline at the band mean.
        (sum_y / m, 0.0)
    };
    let baseline = a + b * peak_q as f32;

    // Prominence in dB. The cepstrum here is in dB units (it is the inverse
    // transform of the dB log-magnitude spectrum), so the difference is already
    // a dB prominence.
    let prominence = peak_val - baseline;
    if prominence.is_finite() {
        Some(prominence)
    } else {
        None
    }
}

/// Smallest power of two `>= x` (x clamped to at least 1).
fn next_pow2(x: usize) -> usize {
    let x = x.max(1);
    let mut p = 1usize;
    while p < x {
        p <<= 1;
    }
    p
}

/// Per-frame cepstral peak prominence (dB): peak within the f0-biased voice band
/// minus the wide-range linear-regression baseline. This is the single-frame CPP
/// measurement that [`cpps`] averages across frames. `cep` is a real cepstrum in
/// dB units (length `WINDOW/2 + 1`).
fn frame_prominence(cep: &[f32], sr: f32, f0: f32) -> Option<f32> {
    if cep.len() < 4 {
        return None;
    }
    let max_q = cep.len() - 1;

    // --- Peak-search band: voice quefrency for F0 in 60..330 Hz. ----------
    // q = sr / f_hz, so higher Hz → lower quefrency.
    let mut q_lo = (sr / 330.0).floor() as usize; // smallest quefrency (330 Hz)
    let mut q_hi = (sr / 60.0).ceil() as usize; // largest quefrency (60 Hz)
    q_lo = q_lo.max(1);
    q_hi = q_hi.min(max_q.saturating_sub(1));
    if q_lo >= q_hi {
        return None;
    }
    // Bias toward the provided f0 when it is finite and inside the band: shrink
    // the search to ±20% around sr/f0 (still clamped to the voice band).
    if f0.is_finite() && f0 >= 60.0 && f0 <= 330.0 {
        let q0 = sr / f0;
        let lo = (q0 * 0.8).floor() as usize;
        let hi = (q0 * 1.2).ceil() as usize;
        q_lo = q_lo.max(lo.max(1));
        q_hi = q_hi.min(hi);
        if q_lo >= q_hi {
            return None;
        }
    }

    // Cepstral peak within the band.
    let mut peak_q = q_lo;
    let mut peak_val = cep[q_lo];
    for q in q_lo..=q_hi {
        if cep[q] > peak_val {
            peak_val = cep[q];
            peak_q = q;
        }
    }

    // --- Wide-range regression baseline (as in `cpp`). --------------------
    // From ~1 ms (above the spectral-envelope/formant region) to the Nyquist
    // quefrency. Fit val = a + b*q by least squares.
    let baseline_lo = ((sr * 0.001).round() as usize).max(1);
    let baseline_hi = max_q.saturating_sub(1);
    if baseline_lo >= baseline_hi {
        return None;
    }
    let band: Vec<(f32, f32)> = (baseline_lo..=baseline_hi)
        .map(|q| (q as f32, cep[q]))
        .collect();
    let m = band.len() as f32;
    let sum_x: f32 = band.iter().map(|(qx, _)| *qx).sum();
    let sum_y: f32 = band.iter().map(|(_, qy)| *qy).sum();
    let sum_xx: f32 = band.iter().map(|(qx, _)| qx * qx).sum();
    let sum_xy: f32 = band.iter().map(|(qx, qy)| qx * qy).sum();
    let denom = m * sum_xx - sum_x * sum_x;
    let (a, b) = if denom.abs() > 1e-12 {
        let b = (m * sum_xy - sum_x * sum_y) / denom;
        let a = (sum_y - b * sum_x) / m;
        (a, b)
    } else {
        (sum_y / m, 0.0)
    };
    let baseline = a + b * peak_q as f32;

    let prominence = peak_val - baseline;
    if prominence.is_finite() {
        Some(prominence)
    } else {
        None
    }
}

/// CPPS (smoothed cepstral peak prominence) in dB — Hillenbrand/Awan/Maryn.
///
/// CPPS is the smoothed sibling of [`cpp`]: it frames the input and aggregates
/// across frames so the prominence is far more stable on a sustained tone than
/// the single-frame `cpp`. Two design points make it robust on the real
/// 48 kHz, multi-second, slightly-drifting capture path:
///
/// 1. **Sample-rate-aware window.** The cepstral frequency resolution is
///    `sr/WINDOW` Hz per bin; the rahmonic ripple that produces the peak needs
///    several bins per harmonic. We pick `WINDOW = next_pow2(sr * 85 ms)`
///    (≈4096 at 48 kHz, ≈1024 at 16 kHz) so each harmonic spans ~12+ bins. A
///    fixed 1024-sample window at 48 kHz under-resolves harmonics (~47 Hz/bin),
///    collapsing the peak to ~0 dB — the bug this replaces.
/// 2. **Per-frame prominence averaging (not cepstrum averaging).** The rahmonic
///    peak sits at quefrency `sr/f0`; when F0 drifts across a multi-second hold
///    that quefrency migrates, so averaging the raw cepstra smears the peak.
///    Instead we compute the CPP prominence *per frame* (peak + wide baseline)
///    and average the prominences — drift no longer flattens the result. A short
///    quefrency moving-average is still applied per frame ("S" smoothing).
///
/// The peak is searched in the voice quefrency band for F0 in 60..330 Hz,
/// biased toward `f0` when finite and in range; the baseline is the wide-range
/// linear-regression floor. Result is in the dB cepstral domain, consistent with
/// [`cpp`]. To bound cost on a long held vowel we analyze at most `MAX_FRAMES`
/// frames evenly spaced across the input.
///
/// Returns `None` on short / degenerate input (fewer than 2 usable frames, an
/// unresolvable quefrency band, or a degenerate spectrum).
// Spec'd voice-quality feature (spec A4); consumed once per held tone in
// finish_held_note (feeds the harmonic sub-metric + the raw state-signals block).
pub fn cpps(samples: &[f32], sr: f32, f0: f32) -> Option<f32> {
    if samples.is_empty() || !sr.is_finite() || sr <= 0.0 {
        return None;
    }

    // Sample-rate-aware window so harmonics are adequately resolved in the
    // cepstrum (~85 ms → ~12 Hz/bin at 48 kHz). At 16 kHz this is 1024.
    let window = next_pow2((sr * 0.085) as usize).clamp(256, 8192);
    let hop = window / 2; // 50% overlap
    const MAX_FRAMES: usize = 32; // bound cost on a long held tone

    let n = samples.len();
    if n < window {
        return None;
    }

    // Frame starts at a 50% hop, then evenly subsample down to MAX_FRAMES so a
    // long input still costs O(32) cepstra rather than hundreds.
    let n_hops = (n - window) / hop + 1;
    if n_hops < 2 {
        return None;
    }
    let mut starts: Vec<usize> = Vec::new();
    if n_hops <= MAX_FRAMES {
        for h in 0..n_hops {
            starts.push(h * hop);
        }
    } else {
        // Evenly spaced across [0, last_start].
        let last_start = (n_hops - 1) * hop;
        for j in 0..MAX_FRAMES {
            let s = (j as f64 * last_start as f64 / (MAX_FRAMES - 1) as f64).round() as usize;
            starts.push(s);
        }
        starts.dedup();
    }
    if starts.len() < 2 {
        return None;
    }

    // Precompute the Hann window once.
    let hann: Vec<f32> = (0..window)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (window as f32 - 1.0)).cos())
        .collect();

    // --- Per-frame prominence; average across frames (drift-robust). ------
    const SMOOTH_HALF: usize = 1; // 3-tap quefrency moving average per frame
    let mut prom_sum = 0.0f32;
    let mut used = 0usize;
    for &start in &starts {
        let seg = &samples[start..start + window];
        let windowed: Vec<f32> = seg.iter().zip(&hann).map(|(s, w)| s * w).collect();
        let cep = real_cepstrum(&windowed);
        if cep.len() < 4 {
            continue;
        }
        // Quefrency smoothing: short moving average across quefrency.
        let len = cep.len();
        let mut smooth = vec![0.0f32; len];
        for q in 0..len {
            let lo = q.saturating_sub(SMOOTH_HALF);
            let hi = (q + SMOOTH_HALF).min(len - 1);
            let mut acc = 0.0f32;
            for v in &cep[lo..=hi] {
                acc += *v;
            }
            smooth[q] = acc / (hi - lo + 1) as f32;
        }
        if let Some(p) = frame_prominence(&smooth, sr, f0) {
            prom_sum += p;
            used += 1;
        }
    }
    if used < 2 {
        return None;
    }
    let prominence = prom_sum / used as f32;
    if prominence.is_finite() {
        Some(prominence)
    } else {
        None
    }
}

/// Real cepstrum in dB units: inverse cosine transform of the dB log-magnitude
/// spectrum of a real signal. Returns `n/2 + 1` quefrency samples.
///
/// Naive O(n^2) DFT + IDFT — std-only and adequate for the modest window sizes
/// used here, matching the naive-DFT helper style in harmonics.rs tests.
#[allow(dead_code)] // helper for cpp(); part of the spec'd voice-quality toolbox
fn real_cepstrum(signal: &[f32]) -> Vec<f32> {
    let n = signal.len();
    if n == 0 {
        return Vec::new();
    }
    let half = n / 2;

    // Log-magnitude spectrum (in dB) over the unique 0..=half bins.
    let mut log_mag = vec![0.0f32; half + 1];
    for (k, slot) in log_mag.iter_mut().enumerate() {
        let mut re = 0.0f64;
        let mut im = 0.0f64;
        let w = -2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
        for (i, &s) in signal.iter().enumerate() {
            let ph = w * (i as f64);
            re += (s as f64) * ph.cos();
            im += (s as f64) * ph.sin();
        }
        let mag = ((re * re + im * im).sqrt()) as f32;
        *slot = lin_to_db(mag);
    }

    // The cepstrum is the IDFT of the (real, even) log-magnitude spectrum.
    // Reconstruct the full symmetric spectrum implicitly via a cosine sum:
    //   c[q] = (1/n) * sum_{k=0}^{n-1} S[k] * cos(2*pi*k*q/n)
    // where S is even-symmetric so S[k] = S[n-k] = log_mag[min(k, n-k)].
    let mut cep = vec![0.0f32; half + 1];
    for (q, c) in cep.iter_mut().enumerate() {
        let mut acc = 0.0f64;
        for k in 0..n {
            let idx = if k <= half { k } else { n - k };
            let s = log_mag[idx] as f64;
            let ph = 2.0 * std::f64::consts::PI * (k as f64) * (q as f64) / (n as f64);
            acc += s * ph.cos();
        }
        *c = (acc / n as f64) as f32;
    }
    cep
}

/// H1-H2 in dB: difference of the first two harmonic peak magnitudes (dB).
///
/// A tension / breathiness indicator (docs section 3.2). Input is the harmonic
/// peak magnitudes in dB as produced by `HarmonicInfo.amps_db`. Returns
/// `H1 - H2` (the first entry minus the second), or `None` if fewer than two
/// entries (or non-finite values) are supplied.
// Spec'd tension/breathiness feature (docs section 3.1); validated and ready to
// wire into the per-hop readout, not yet consumed.
#[allow(dead_code)]
pub fn h1_h2_db(harmonic_amps_db: &[f32]) -> Option<f32> {
    if harmonic_amps_db.len() < 2 {
        return None;
    }
    let h1 = harmonic_amps_db[0];
    let h2 = harmonic_amps_db[1];
    if !h1.is_finite() || !h2.is_finite() {
        return None;
    }
    Some(h1 - h2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn sine(freq: f32, sr: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * PI * freq * i as f32 / sr).sin())
            .collect()
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

    // ---- shimmer ----------------------------------------------------------

    #[test]
    fn steady_tone_has_small_shimmer() {
        let sr = 48_000.0;
        let f0 = 200.0;
        let s = sine(f0, sr, 2048);
        let sh = shimmer(&s, sr, f0).expect("shimmer");
        // A constant-amplitude tone has essentially no cycle-to-cycle variation.
        assert!(sh < 0.05, "steady shimmer {sh} should be small");
    }

    #[test]
    fn amplitude_modulated_tone_has_larger_shimmer() {
        let sr = 48_000.0_f32;
        let f0 = 200.0_f32;
        let n = 2048;
        let period = (sr / f0).round() as usize;
        // Alternate the amplitude every period so consecutive cycle peaks differ
        // markedly — a strong, deterministic shimmer.
        let mut sig = vec![0.0f32; n];
        for (i, sample) in sig.iter_mut().enumerate() {
            let cycle = i / period;
            let amp = if cycle % 2 == 0 { 1.0 } else { 0.6 };
            *sample = amp * (2.0 * PI * f0 * i as f32 / sr).sin();
        }
        let sh = shimmer(&sig, sr, f0).expect("shimmer");
        let steady = shimmer(&sine(f0, sr, n), sr, f0).expect("steady shimmer");
        assert!(
            sh > steady + 0.1,
            "modulated shimmer {sh} should clearly exceed steady {steady}"
        );
    }

    #[test]
    fn shimmer_rejects_invalid_input() {
        let sr = 48_000.0;
        assert!(shimmer(&[], sr, 200.0).is_none());
        assert!(shimmer(&[1.0; 2048], sr, 0.0).is_none());
        assert!(shimmer(&[1.0; 2048], 0.0, 200.0).is_none());
    }

    #[test]
    fn shimmer_none_for_too_few_periods() {
        let sr = 48_000.0_f32;
        let f0 = 200.0_f32;
        let period = (sr / f0).round() as usize; // 240 samples
        // Only ~2 periods of data → fewer than 3 peaks.
        let s = sine(f0, sr, period * 2);
        assert!(shimmer(&s, sr, f0).is_none());
    }

    // ---- cpp --------------------------------------------------------------

    #[test]
    fn periodic_tone_has_higher_cpp_than_noise() {
        let sr = 16_000.0;
        let f0 = 200.0;
        let n = 1024;
        // Rich periodic signal → strong rahmonic peak.
        let tone = sawtooth(f0, sr, n, 12);
        let c_tone = cpp(&tone, sr, f0).expect("cpp tone");

        // Deterministic white noise (LCG) at the same length → no rahmonic peak.
        let mut seed: u64 = 0x0bad_f00d_dead_beef;
        let mut noise = || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((seed >> 33) as f32 / (1u64 << 31) as f32) - 1.0
        };
        let noisy: Vec<f32> = (0..n).map(|_| noise()).collect();
        let c_noise = cpp(&noisy, sr, f0).expect("cpp noise");

        assert!(
            c_tone > c_noise,
            "tone CPP {c_tone} should exceed noise CPP {c_noise}"
        );
        assert!(c_tone > 0.0, "tone CPP {c_tone} should be positive");
    }

    #[test]
    fn cpp_rejects_invalid_or_short_input() {
        let sr = 16_000.0;
        assert!(cpp(&[], sr, 200.0).is_none());
        assert!(cpp(&[0.1; 1024], sr, 0.0).is_none());
        assert!(cpp(&[0.1; 1024], 0.0, 200.0).is_none());
        // Too short to resolve the expected quefrency (sr/f0 = 320 samples).
        assert!(cpp(&[0.1; 32], sr, 50.0).is_none());
    }

    // ---- cpps -------------------------------------------------------------

    // Deterministic LCG white noise in [-1, 1), matching the cpp test style.
    fn lcg_noise(n: usize, seed: u64) -> Vec<f32> {
        let mut s = seed;
        let mut next = || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((s >> 33) as f32 / (1u64 << 31) as f32) - 1.0
        };
        (0..n).map(|_| next()).collect()
    }

    #[test]
    fn cpps_clean_tone_beats_breathy_and_noise() {
        let sr = 16_000.0;
        let f0 = 160.0;
        // A few seconds of audio so multiple frames are smoothed together.
        let n = 16_000;

        // Clean, richly-harmonic sustained tone → strong, stable rahmonic peak.
        let clean = sawtooth(f0, sr, n, 16);
        let c_clean = cpps(&clean, sr, f0).expect("cpps clean");

        // Breathy version: same periodic core plus substantial additive noise,
        // which fills in the cepstral floor and lowers the prominence.
        let noise = lcg_noise(n, 0x1234_5678_9abc_def0);
        let breathy: Vec<f32> = clean
            .iter()
            .zip(&noise)
            .map(|(t, no)| 0.5 * t + 0.8 * no)
            .collect();
        let c_breathy = cpps(&breathy, sr, f0).expect("cpps breathy");

        // Pure white noise → no periodicity at all.
        let pure_noise = lcg_noise(n, 0x0bad_f00d_dead_beef);
        let c_noise = cpps(&pure_noise, sr, f0).expect("cpps noise");

        assert!(
            c_clean > c_breathy,
            "clean CPPS {c_clean} should exceed breathy {c_breathy}"
        );
        assert!(
            c_clean > c_noise,
            "clean CPPS {c_clean} should exceed white-noise {c_noise}"
        );
    }

    #[test]
    fn cpps_rises_with_harmonic_periodicity() {
        let sr = 16_000.0;
        let f0 = 150.0;
        let n = 16_000;
        // More harmonics → sharper periodicity → higher cepstral peak.
        let weak = sawtooth(f0, sr, n, 2);
        let strong = sawtooth(f0, sr, n, 20);
        let c_weak = cpps(&weak, sr, f0).expect("cpps weak");
        let c_strong = cpps(&strong, sr, f0).expect("cpps strong");
        assert!(
            c_strong > c_weak,
            "stronger periodicity CPPS {c_strong} should exceed weaker {c_weak}"
        );
    }

    #[test]
    fn cpps_none_for_too_short_input() {
        let sr = 16_000.0;
        // Shorter than a single 1024 window → cannot frame.
        assert!(cpps(&[0.1; 512], sr, 160.0).is_none());
        // Exactly one window → only one frame, need >= 2.
        assert!(cpps(&[0.1; 1024], sr, 160.0).is_none());
        assert!(cpps(&[], sr, 160.0).is_none());
        assert!(cpps(&[0.1; 16_000], 0.0, 160.0).is_none());
    }

    #[test]
    fn cpps_finite_and_plausible_for_vowel_like_tone() {
        let sr = 16_000.0;
        let f0 = 200.0;
        let n = 16_000;
        // Vowel-like: harmonic source with a mild lowpass-ish taper.
        let tone = sawtooth(f0, sr, n, 14);
        let c = cpps(&tone, sr, f0).expect("cpps vowel");
        assert!(c.is_finite(), "cpps should be finite, got {c}");
        // CPP(S) for clear voice sits in a low-tens-of-dB range; assert a wide,
        // non-degenerate sanity band rather than an exact value.
        assert!(c > 0.0 && c < 60.0, "cpps {c} out of plausible range");
    }

    /// A realistic sustained vowel at `sr`: a harmonic complex whose F0 drifts
    /// linearly from `f0_start` to `f0_end`, shaped by a few formant resonances
    /// (simple resonant gains applied to each harmonic). Phase is integrated from
    /// the instantaneous F0 so the drift is continuous (no discontinuities).
    fn drifting_vowel(sr: f32, secs: f32, f0_start: f32, f0_end: f32, n_harm: usize) -> Vec<f32> {
        let n = (sr * secs) as usize;
        // Formant centers/bandwidths roughly for an /a/-like vowel.
        let formants = [(700.0f32, 80.0f32), (1100.0, 90.0), (2600.0, 160.0)];
        let mut out = vec![0.0f32; n];
        let mut phase = 0.0f32; // fundamental phase, integrated from drifting f0
        for (i, s) in out.iter_mut().enumerate() {
            let frac = i as f32 / n as f32;
            let f0 = f0_start + (f0_end - f0_start) * frac;
            phase += 2.0 * PI * f0 / sr;
            let mut v = 0.0f32;
            for k in 1..=n_harm {
                let fh = k as f32 * f0;
                // Gentle glottal source tilt (1/sqrt(k)) keeps a dense harmonic
                // comb out to high harmonics (sharp rahmonic peak), shaped by a
                // few resonant formants plus a small broadband floor.
                let mut gain = 1.0 / (k as f32).sqrt();
                let mut res = 0.05f32;
                for (fc, bw) in formants {
                    let d = (fh - fc) / bw;
                    res += 1.0 / (1.0 + d * d);
                }
                gain *= res;
                v += gain * (k as f32 * phase).sin();
            }
            *s = v;
        }
        // Normalize to roughly unit peak.
        let peak = out.iter().fold(0.0f32, |m, &x| m.max(x.abs())).max(1e-9);
        for s in out.iter_mut() {
            *s /= peak;
        }
        out
    }

    #[test]
    fn cpps_clean_48k_drifting_vowel_is_well_above_zero() {
        // Regression for the "CPPS ~0 dB at 48 kHz" bug: a fixed 1024-sample
        // window under-resolved harmonics at 48 kHz and averaging the cepstra
        // smeared the drifting rahmonic peak, collapsing CPPS to ~0.1-0.5 dB.
        let sr = 48_000.0;
        let secs = 3.0;
        // Slight, realistic F0 drift across the hold.
        let clean = drifting_vowel(sr, secs, 158.0, 166.0, 70);
        let mean_f0 = 162.0;
        let c_clean = cpps(&clean, sr, mean_f0).expect("cpps clean 48k");
        assert!(
            c_clean > 4.0,
            "clean 48k drifting vowel CPPS {c_clean} should be clearly above ~4 dB, not ~0"
        );

        // A stationary 48 kHz vowel should also read clearly non-zero, and the
        // drifting case must stay close to it (guards against re-introducing the
        // cepstrum-averaging smear that drift would then flatten).
        let stationary = drifting_vowel(sr, secs, 162.0, 162.0, 70);
        let c_stat = cpps(&stationary, sr, mean_f0).expect("cpps stationary 48k");
        assert!(
            c_stat > 4.0,
            "stationary 48k vowel CPPS {c_stat} should be clearly above ~4 dB"
        );
        assert!(
            (c_clean - c_stat).abs() < 3.0,
            "drift {c_clean} should stay within a few dB of stationary {c_stat}"
        );

        // Breathy version: same periodic core plus strong additive noise fills the
        // cepstral floor and must lower the prominence well below the clean tone.
        let noise = lcg_noise(clean.len(), 0xfeed_face_cafe_d00d);
        let breathy: Vec<f32> = clean
            .iter()
            .zip(&noise)
            .map(|(t, no)| 0.5 * t + 0.9 * no)
            .collect();
        let c_breathy = cpps(&breathy, sr, mean_f0).expect("cpps breathy 48k");
        assert!(
            c_clean > c_breathy + 2.0,
            "clean 48k CPPS {c_clean} should clearly exceed breathy {c_breathy}"
        );
    }

    // ---- h1_h2_db ---------------------------------------------------------

    #[test]
    fn h1_h2_returns_difference_of_first_two() {
        let amps = vec![-10.0f32, -16.0, -22.0, -30.0];
        let d = h1_h2_db(&amps).expect("h1-h2");
        assert!((d - 6.0).abs() < 1e-6, "h1-h2 = {d}");
    }

    #[test]
    fn h1_h2_none_for_too_few_entries() {
        assert!(h1_h2_db(&[]).is_none());
        assert!(h1_h2_db(&[-12.0]).is_none());
    }

    #[test]
    fn h1_h2_rejects_non_finite() {
        assert!(h1_h2_db(&[f32::NAN, -10.0]).is_none());
        assert!(h1_h2_db(&[-10.0, f32::INFINITY]).is_none());
    }
}
