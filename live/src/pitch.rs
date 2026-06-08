//! Pitch detection (YIN), note naming, and pitch-stability tracking.
//!
//! All DSP functions operate on plain slices so they are unit-testable
//! without an audio device. `PitchTracker` keeps a rolling history of
//! per-hop F0 estimates and derives jitter (short-term cents std-dev) and
//! drift (slow cents change of the currently held note).

use std::collections::VecDeque;

/// YIN fundamental-frequency estimation.
///
/// Returns `Some((f0_hz, confidence))` where `confidence` is in `0..=1`
/// (`1 - cmnd` at the chosen lag), or `None` if the frame is judged
/// unvoiced. Designed for a ~2048-sample window at 44.1/48 kHz.
///
/// Algorithm (de Cheveigné & Kawahara 2002):
/// 1. squared-difference function over the first half of the window,
/// 2. cumulative-mean-normalized difference (CMND),
/// 3. search lag range `sr/500 .. sr/70`,
/// 4. absolute threshold 0.15 with descent to the local minimum,
///    falling back to the global minimum,
/// 5. reject (unvoiced) if best CMND > 0.2,
/// 6. parabolic interpolation of the lag for sub-sample accuracy.
pub fn yin(samples: &[f32], sr: f32) -> Option<(f32, f32)> {
    const ABS_THRESHOLD: f32 = 0.15;
    const REJECT_CMND: f32 = 0.2;

    let n = samples.len();
    if n < 4 || sr <= 0.0 {
        return None;
    }

    // The difference function compares the first half of the window against a
    // tau-shifted copy, so usable lags are bounded by half the window.
    let half = n / 2;

    // Lag range for the chant range 70..500 Hz.
    let min_lag = (sr / 500.0).floor().max(2.0) as usize;
    let mut max_lag = (sr / 70.0).ceil() as usize;
    if max_lag >= half {
        max_lag = half.saturating_sub(1);
    }
    if min_lag >= max_lag || max_lag == 0 {
        return None;
    }

    // Step 1: difference function d(tau) = sum_j (x[j] - x[j+tau])^2.
    let mut diff = vec![0.0f32; max_lag + 1];
    for tau in 1..=max_lag {
        let mut sum = 0.0f32;
        for j in 0..half {
            let delta = samples[j] - samples[j + tau];
            sum += delta * delta;
        }
        diff[tau] = sum;
    }

    // Step 2: cumulative-mean-normalized difference.
    // cmnd[0] = 1; cmnd[tau] = d[tau] / ((1/tau) * sum_{1..=tau} d).
    let mut cmnd = vec![1.0f32; max_lag + 1];
    let mut running = 0.0f32;
    for tau in 1..=max_lag {
        running += diff[tau];
        cmnd[tau] = if running <= 0.0 {
            // Total energy is ~0 (e.g. silence): no usable pitch here.
            1.0
        } else {
            diff[tau] * (tau as f32) / running
        };
    }

    // Step 3+4: find best lag within the range.
    // Absolute-threshold rule: smallest tau where cmnd dips below
    // ABS_THRESHOLD, then descend to the local minimum of that dip.
    let mut best_tau = 0usize;
    let mut tau = min_lag;
    while tau <= max_lag {
        if cmnd[tau] < ABS_THRESHOLD {
            while tau + 1 <= max_lag && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            best_tau = tau;
            break;
        }
        tau += 1;
    }

    // Fallback: global minimum of CMND across the range.
    if best_tau == 0 {
        let mut min_val = f32::INFINITY;
        for t in min_lag..=max_lag {
            if cmnd[t] < min_val {
                min_val = cmnd[t];
                best_tau = t;
            }
        }
    }

    if best_tau == 0 {
        return None;
    }

    let best_cmnd = cmnd[best_tau];
    if best_cmnd > REJECT_CMND {
        return None;
    }

    // Step 6: parabolic interpolation around best_tau using the CMND curve.
    let refined = parabolic_lag(&cmnd, best_tau, min_lag, max_lag);
    if refined <= 0.0 {
        return None;
    }

    let f0 = sr / refined;
    if !f0.is_finite() || f0 <= 0.0 {
        return None;
    }

    let confidence = (1.0 - best_cmnd).clamp(0.0, 1.0);
    Some((f0, confidence))
}

/// Parabolic interpolation of the minimum location near `tau` using three
/// CMND samples. Returns a sub-sample lag.
fn parabolic_lag(cmnd: &[f32], tau: usize, min_lag: usize, max_lag: usize) -> f32 {
    if tau <= min_lag || tau >= max_lag {
        return tau as f32;
    }
    let s0 = cmnd[tau - 1];
    let s1 = cmnd[tau];
    let s2 = cmnd[tau + 1];
    let denom = s0 + s2 - 2.0 * s1;
    if denom.abs() < 1e-12 {
        return tau as f32;
    }
    let shift = 0.5 * (s0 - s2) / denom;
    if shift.abs() > 1.0 {
        return tau as f32;
    }
    tau as f32 + shift
}

const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Convert a frequency to a note name with cents offset, e.g. `"D3 +4c"`.
///
/// `midi = 69 + 12*log2(f0/440)`; the nearest semitone names the note and the
/// fractional remainder becomes the cents offset (A4 = 440 Hz).
pub fn hz_to_note(f0: f32) -> String {
    if !(f0 > 0.0) {
        return "—".to_string();
    }
    let midi_f = 69.0 + 12.0 * (f0 / 440.0).log2();
    let midi = midi_f.round() as i32;
    let cents = ((midi_f - midi as f32) * 100.0).round() as i32;

    // MIDI 0 = C-1, so octave = midi/12 - 1.
    let name = NOTE_NAMES[(midi.rem_euclid(12)) as usize];
    let octave = midi.div_euclid(12) - 1;

    format!("{}{} {:+}c", name, octave, cents)
}

/// Cents difference from `a` to `b`: `1200 * log2(b/a)`.
fn cents_between(a: f32, b: f32) -> f32 {
    1200.0 * (b / a).log2()
}

/// Rolling pitch-stability tracker.
///
/// Stores up to 60 s of per-hop `(hop_index, f0)` for voiced frames and
/// computes jitter/drift relative to the currently held note. The note onset
/// is reset whenever there is an unvoiced gap (> 3 consecutive `None`) or the
/// F0 jumps by more than 150 cents.
pub struct PitchTracker {
    /// Voiced history: `(hop_index, f0_hz)`.
    pub history: VecDeque<(u64, f32)>,
    /// Hops per second (environment/analysis rate).
    env_rate: f32,
    /// Capacity in samples for ~60 s of history.
    capacity: usize,
    /// Hop index at which the current note started.
    onset_hop: Option<u64>,
    /// Last voiced f0 seen (for jump detection).
    last_f0: Option<f32>,
    /// Consecutive unvoiced (None) pushes since the last voiced frame.
    consecutive_none: u32,
}

impl PitchTracker {
    /// `env_rate` = hops per second; sizes history for ~60 s.
    pub fn new(env_rate: f32) -> Self {
        let rate = if env_rate > 0.0 { env_rate } else { 1.0 };
        let capacity = ((rate * 60.0).ceil() as usize).max(8);
        PitchTracker {
            history: VecDeque::with_capacity(capacity),
            env_rate: rate,
            capacity,
            onset_hop: None,
            last_f0: None,
            consecutive_none: 0,
        }
    }

    /// Push one hop's result. `None` => unvoiced. Resets the note-onset marker
    /// on an unvoiced gap (> 3 consecutive `None`) or an F0 jump > 150 cents.
    pub fn push(&mut self, hop: u64, f0: Option<f32>) {
        match f0 {
            Some(f) if f > 0.0 && f.is_finite() => {
                // New-note detection: jump from the previous voiced frame.
                let new_note = match self.last_f0 {
                    Some(prev) => cents_between(prev, f).abs() > 150.0,
                    None => true,
                };
                if new_note {
                    self.onset_hop = Some(hop);
                }
                self.consecutive_none = 0;
                self.last_f0 = Some(f);

                self.history.push_back((hop, f));
                while self.history.len() > self.capacity {
                    self.history.pop_front();
                }
            }
            // None or a non-finite/non-positive f0 is treated as unvoiced.
            _ => {
                self.consecutive_none += 1;
                if self.consecutive_none > 3 {
                    // Long unvoiced gap ends the current note.
                    self.onset_hop = None;
                    self.last_f0 = None;
                }
            }
        }
    }

    /// Hop index at which the currently held note started, or `None` when no
    /// note is active (after an unvoiced gap or before the first voiced frame).
    /// Used by the sustained-tone capture to tell when a held note is the same
    /// one across hops (a change of onset marks a new note).
    pub fn onset(&self) -> Option<u64> {
        self.onset_hop
    }

    /// Std-dev in cents (vs the local mean) over the last ~1 s of voiced
    /// frames of the current note. `None` if too few frames.
    pub fn jitter_cents(&self) -> Option<f32> {
        let onset = self.onset_hop?;
        let window_hops = (self.env_rate * 1.0).round() as u64;
        let latest = self.history.back()?.0;
        let start_hop = latest.saturating_sub(window_hops);

        // Frames within the last ~1 s and within the current note.
        let freqs: Vec<f32> = self
            .history
            .iter()
            .filter(|(h, _)| *h >= start_hop && *h >= onset)
            .map(|(_, f)| *f)
            .collect();

        if freqs.len() < 3 {
            return None;
        }

        // Convert each to cents relative to the geometric mean, then std-dev.
        let mean = geometric_mean(&freqs)?;
        let cents: Vec<f32> = freqs.iter().map(|&f| cents_between(mean, f)).collect();
        let m = cents.iter().sum::<f32>() / cents.len() as f32;
        let var = cents.iter().map(|c| (c - m) * (c - m)).sum::<f32>() / cents.len() as f32;
        Some(var.sqrt())
    }

    /// Slow drift of the current note: cents from the onset median to the
    /// recent median, using ~2 s medians within the current note.
    /// `None` if there isn't enough held-note history.
    pub fn drift_cents(&self) -> Option<f32> {
        let onset = self.onset_hop?;
        let span_hops = (self.env_rate * 2.0).round() as u64;
        let latest = self.history.back()?.0;

        // Onset window: first ~2 s of the current note.
        let onset_freqs: Vec<f32> = self
            .history
            .iter()
            .filter(|(h, _)| *h >= onset && *h <= onset.saturating_add(span_hops))
            .map(|(_, f)| *f)
            .collect();

        // Recent window: last ~2 s, still within the current note.
        let recent_start = latest.saturating_sub(span_hops);
        let recent_freqs: Vec<f32> = self
            .history
            .iter()
            .filter(|(h, _)| *h >= onset && *h >= recent_start)
            .map(|(_, f)| *f)
            .collect();

        if onset_freqs.len() < 3 || recent_freqs.len() < 3 {
            return None;
        }

        let onset_med = median(&onset_freqs)?;
        let recent_med = median(&recent_freqs)?;
        if onset_med <= 0.0 || recent_med <= 0.0 {
            return None;
        }
        Some(cents_between(onset_med, recent_med))
    }
}

/// Geometric mean of positive values.
fn geometric_mean(xs: &[f32]) -> Option<f32> {
    if xs.is_empty() {
        return None;
    }
    let mut sum_ln = 0.0f32;
    for &x in xs {
        if x <= 0.0 {
            return None;
        }
        sum_ln += x.ln();
    }
    Some((sum_ln / xs.len() as f32).exp())
}

/// Median of a slice (does not require pre-sorted input).
fn median(xs: &[f32]) -> Option<f32> {
    if xs.is_empty() {
        return None;
    }
    let mut v: Vec<f32> = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = v.len() / 2;
    if v.len() % 2 == 1 {
        Some(v[mid])
    } else {
        Some(0.5 * (v[mid - 1] + v[mid]))
    }
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

    #[test]
    fn yin_detects_200hz() {
        let sr = 48_000.0;
        let s = sine(200.0, sr, 2048);
        let (f0, conf) = yin(&s, sr).expect("voiced");
        assert!((f0 - 200.0).abs() < 1.0, "f0 = {f0}");
        assert!(conf > 0.8, "conf = {conf}");
    }

    #[test]
    fn yin_detects_440hz() {
        let sr = 48_000.0;
        let s = sine(440.0, sr, 2048);
        let (f0, _) = yin(&s, sr).expect("voiced");
        assert!((f0 - 440.0).abs() < 1.0, "f0 = {f0}");
    }

    #[test]
    fn yin_no_octave_error_at_100hz() {
        let sr = 48_000.0;
        let s = sine(100.0, sr, 2048);
        let (f0, _) = yin(&s, sr).expect("voiced");
        // Must not halve (50) or double (200).
        assert!((f0 - 100.0).abs() < 2.0, "f0 = {f0}");
    }

    #[test]
    fn yin_rejects_white_noise() {
        let sr = 48_000.0;
        // Deterministic pseudo-random white noise.
        let mut state: u32 = 0x1234_5678;
        let n = 2048;
        let s: Vec<f32> = (0..n)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
            })
            .collect();
        assert!(yin(&s, sr).is_none(), "white noise should be unvoiced");
    }

    #[test]
    fn yin_rejects_silence() {
        let sr = 48_000.0;
        let s = vec![0.0f32; 2048];
        let r = yin(&s, sr);
        assert!(r.is_none(), "silence should be unvoiced, got {r:?}");
    }

    #[test]
    fn note_a4_is_440() {
        assert_eq!(hz_to_note(440.0), "A4 +0c");
    }

    #[test]
    fn note_middle_c() {
        // C4 ~ 261.63 Hz.
        assert_eq!(hz_to_note(261.63), "C4 +0c");
    }

    #[test]
    fn note_has_cents_offset() {
        // Slightly sharp A4.
        let s = hz_to_note(443.0);
        assert!(s.starts_with("A4 "), "got {s}");
        assert!(s.contains('+'), "expected positive cents, got {s}");
    }

    #[test]
    fn tracker_jitter_near_zero_for_constant_f0() {
        let mut t = PitchTracker::new(11.0); // ~11 hops/s
        for hop in 0..30u64 {
            t.push(hop, Some(220.0));
        }
        let j = t.jitter_cents().expect("jitter");
        assert!(j < 0.5, "jitter = {j}");
    }

    #[test]
    fn tracker_drift_detects_ramp() {
        let mut t = PitchTracker::new(11.0);
        // Slow ramp from 200 Hz upward; per-frame step is tiny (well under
        // 150 cents) so it stays one note, but the overall drift is large.
        let n = 60u64;
        for hop in 0..n {
            let f = 200.0 + 0.3 * hop as f32;
            t.push(hop, Some(f));
        }
        let d = t.drift_cents().expect("drift");
        // Upward ramp -> clearly positive drift.
        assert!(d > 30.0, "drift = {d}");
    }

    #[test]
    fn tracker_resets_note_on_large_jump() {
        let mut t = PitchTracker::new(11.0);
        for hop in 0..10u64 {
            t.push(hop, Some(200.0));
        }
        // Jump of an octave (1200 cents) starts a new note at hop 10.
        for hop in 10..20u64 {
            t.push(hop, Some(400.0));
        }
        if let Some(d) = t.drift_cents() {
            assert!(d.abs() < 5.0, "drift after new note = {d}");
        }
    }

    #[test]
    fn tracker_resets_on_unvoiced_gap() {
        let mut t = PitchTracker::new(11.0);
        for hop in 0..10u64 {
            t.push(hop, Some(200.0));
        }
        // > 3 consecutive None ends the note.
        for hop in 10..15u64 {
            t.push(hop, None);
        }
        assert!(t.jitter_cents().is_none());
        assert!(t.drift_cents().is_none());
    }

    #[test]
    fn tracker_history_bounded_to_60s() {
        let mut t = PitchTracker::new(10.0); // capacity ~600
        for hop in 0..2000u64 {
            t.push(hop, Some(200.0));
        }
        assert!(t.history.len() <= 600, "len = {}", t.history.len());
    }

    #[test]
    fn yin_handles_short_input_gracefully() {
        assert!(yin(&[0.0; 2], 48_000.0).is_none());
        assert!(yin(&[], 48_000.0).is_none());
    }
}
