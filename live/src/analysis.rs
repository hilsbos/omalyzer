// Per-hop analysis orchestrator: combines pitch, harmonics, formants and
// voice-quality measures into a single AnalysisResult, behind an RMS gate.

use crate::formants::{self, Formants};
use crate::harmonics;
use crate::pitch::{self, PitchTracker};
use crate::spectral;

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
    /// Normalized Shannon spectral entropy of the analysis spectrum (0..=1).
    /// Low = ordered/tonal/coherent. Computed every gate-open frame (it does not
    /// need a usable F0), so it is meaningful for the coherence accumulation.
    pub entropy: f32,
    /// Positive-part spectral flux versus the previous frame (0..1). Frame-to-
    /// frame spectral change; low over a held tone = spectrally stable.
    pub flux: f32,
    /// Mean of the available -3 dB formant bandwidths (b1/b2/b3), in Hz, or
    /// `None` when no formant bandwidth is available.
    pub mean_formant_bw: Option<f32>,
}

/// Run per-hop analysis.
///
/// * `window` — latest time-domain samples (the full FFT window buffer).
/// * `prev_lin` — the previous frame's linear magnitude spectrum (for spectral
///   flux). Pass an empty slice on the first frame; flux is then 0.
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
    prev_lin: &[f32],
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

    // Spectral descriptors of the current frame. These do not need a usable F0
    // (entropy/flux are whole-spectrum measures), so compute them once up front
    // and carry them into every gate-open result, voiced or not.
    let entropy = spectral::spectral_entropy(latest_lin);
    let flux = spectral::spectral_flux(prev_lin, latest_lin);

    // --- Pitch (YIN) on the most recent PITCH_WINDOW samples ----------------
    let pitch_start = window.len().saturating_sub(PITCH_WINDOW);
    let pitch_slice = &window[pitch_start..];
    let yin = pitch::yin(pitch_slice, sample_rate);

    // Advance the tracker every hop (voiced or not) so jitter/drift windows
    // line up with real time.
    let f0_opt = yin.map(|(f, _)| f);
    tracker.push(hop_index, f0_opt);

    // Unvoiced frame: gate is open but no usable pitch (e.g. breath, fricative).
    // Still report the whole-spectrum descriptors for this frame.
    let f0 = match f0_opt {
        Some(f) => f,
        None => {
            return AnalysisResult {
                entropy,
                flux,
                ..AnalysisResult::default()
            }
        }
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
    let Formants {
        f1,
        f2,
        f3,
        b1,
        b2,
        b3,
    } = formants::estimate(window, sample_rate, Some(f0));

    // Mean of the available -3 dB formant bandwidths (Hz).
    let bws: Vec<f32> = [b1, b2, b3].into_iter().flatten().collect();
    let mean_formant_bw = if bws.is_empty() {
        None
    } else {
        Some(bws.iter().sum::<f32>() / bws.len() as f32)
    };

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
        entropy,
        flux,
        mean_formant_bw,
    }
}
