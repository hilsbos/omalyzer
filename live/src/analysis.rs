// Per-hop analysis orchestrator: combines pitch, harmonics, formants and
// voice-quality measures into a single AnalysisResult, behind an RMS gate.

use crate::formants::{self, Formants};
use crate::harmonics;
use crate::pitch::{self, PitchTracker};

/// Number of samples (most recent, from the tail of the window) fed to YIN
/// and the HNR autocorrelation (~43 ms at 48 kHz).
const PITCH_WINDOW: usize = 2048;

#[derive(Clone, Default)]
pub struct AnalysisResult {
    pub voiced: bool,
    pub f0: Option<f32>,
    pub note: Option<String>,
    pub jitter_cents: Option<f32>,
    pub drift_cents: Option<f32>,
    pub harmonic_count: usize,
    /// Per-harmonic peak magnitudes (dB), first 12. Part of the spec'd result;
    /// retained for callers/inspection even though the current readout shows
    /// only count + centroid.
    #[allow(dead_code)]
    pub harmonic_amps: Vec<f32>,
    pub centroid_hz: f32,
    pub f1: Option<f32>,
    pub f2: Option<f32>,
    pub f3: Option<f32>,
    pub vowel: Option<char>,
    pub vowel_conf: f32,
    pub hnr_db: Option<f32>,
}

/// Run per-hop analysis.
///
/// * `window` — latest time-domain samples (the full FFT window buffer).
/// * `latest_lin` — latest linear (window-normalized) magnitude spectrum.
/// * `sample_rate` — capture sample rate in Hz.
/// * `bin_hz` — Hz per FFT bin for `latest_lin`.
/// * `gate_open` — whether RMS exceeds the silence gate threshold.
/// * `hop_index` — monotonically increasing per-hop counter (for the tracker).
/// * `tracker` — rolling pitch-stability state (history/jitter/drift), updated
///   here once per hop so it advances in lock-step with `hop_index`.
///
/// When the gate is closed the tracker still receives an unvoiced `push` so it
/// can time out the current note, and an all-`—` result is returned.
pub fn run(
    window: &[f32],
    latest_lin: &[f32],
    sample_rate: f32,
    bin_hz: f32,
    gate_open: bool,
    hop_index: u64,
    tracker: &mut PitchTracker,
) -> AnalysisResult {
    // Silence gate: nothing voiced below threshold. Still advance the tracker
    // with an unvoiced push so a held note times out while the gate is closed.
    if !gate_open {
        tracker.push(hop_index, None);
        return AnalysisResult::default();
    }

    // --- Pitch (YIN) on the most recent PITCH_WINDOW samples ----------------
    let pitch_start = window.len().saturating_sub(PITCH_WINDOW);
    let pitch_slice = &window[pitch_start..];
    let yin = pitch::yin(pitch_slice, sample_rate);

    // Advance the tracker every hop (voiced or not) so jitter/drift windows
    // line up with real time.
    let f0_opt = yin.map(|(f, _)| f);
    tracker.push(hop_index, f0_opt);

    // Unvoiced frame: gate is open but no usable pitch (e.g. breath, fricative).
    let f0 = match f0_opt {
        Some(f) => f,
        None => return AnalysisResult::default(),
    };

    let note = Some(pitch::hz_to_note(f0));
    let jitter_cents = tracker.jitter_cents();
    let drift_cents = tracker.drift_cents();

    // --- Harmonics on the latest linear spectrum column ---------------------
    let harm = harmonics::analyze(latest_lin, bin_hz, f0);

    // --- HNR on the most recent samples -------------------------------------
    let hnr = harmonics::hnr_db(window, sample_rate, f0);
    let hnr_db = if hnr.is_finite() { Some(hnr) } else { None };

    // --- Formants on the full window ----------------------------------------
    let Formants { f1, f2, f3 } = formants::estimate(window, sample_rate, Some(f0));

    // --- Vowel classification (only with both low formants present) ---------
    let (vowel, vowel_conf) = match (f1, f2) {
        (Some(a), Some(b)) => {
            let (v, c) = formants::classify_vowel(a, b);
            (Some(v), c)
        }
        _ => (None, 0.0),
    };

    AnalysisResult {
        voiced: true,
        f0: Some(f0),
        note,
        jitter_cents,
        drift_cents,
        harmonic_count: harm.count,
        harmonic_amps: harm.amps_db,
        centroid_hz: harm.centroid_hz,
        f1,
        f2,
        f3,
        vowel,
        vowel_conf,
        hnr_db,
    }
}
