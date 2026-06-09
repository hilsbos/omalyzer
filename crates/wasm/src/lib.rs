//! omalyzer-wasm — a thin wasm-bindgen shim over `omalyzer_core::Analyzer`.
//! It owns NO DSP: it drives the core Analyzer and copies its latest state into
//! a flat `Snapshot` for JS. The browser's AudioWorklet feeds whole hops via
//! `push_samples`; the render loop polls `snapshot()` per frame.

use omalyzer_core::{hops_per_sec, Analyzer};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Flat, JS-facing view of the Analyzer's latest state. Defined wasm-side and
/// derives `Serialize` so we never require `Serialize` on core types we don't
/// own — fields are copied out of the core accessors in `snapshot()`.
///
/// Serialized to a JS object via `serde_wasm_bindgen::to_value`. `Option<T>`
/// becomes `null` / value; `Option<char>` is sent as an `Option<String>` so it
/// lands as a JS string (or null), not a code point.
#[derive(Serialize, Default)]
pub struct Snapshot {
    // --- per-capture geometry (constants for the visuals) ---
    /// Monotonic per-hop counter (x-axis key for the plot histories).
    pub hop_index: u64,
    /// Hz per FFT bin of `col_db` (display spectrogram column).
    pub bin_hz: f32,
    /// Number of bins kept per spectrogram column (up to STORE_MAX_HZ).
    pub stored_bins: usize,
    /// Approximate analysis hops per second (sample_rate / HOP).
    pub hops_per_sec: f32,

    // --- live per-hop readout (from last_result) ---
    pub voiced: bool,
    pub f0: Option<f32>,
    pub note: Option<String>,
    pub jitter_cents: Option<f32>,
    pub drift_cents: Option<f32>,
    pub harmonic_count: usize,
    pub centroid_hz: f32,
    pub f1: Option<f32>,
    pub f2: Option<f32>,
    pub f3: Option<f32>,
    pub vowel: Option<String>,
    pub vowel_conf: f32,
    pub hnr_db: Option<f32>,
    /// Normalized Shannon spectral entropy of the analysis spectrum (0..=1).
    pub entropy: f32,
    /// Positive-part spectral flux versus the previous frame (0..1).
    pub flux: f32,
    /// Alpha ratio (spectral tilt) in dB, or null when no usable band energy.
    pub alpha_ratio_db: Option<f32>,
    /// Most-recent per-hop RMS amplitude, in dBFS.
    pub rms_db: f32,
    /// Latest dB spectrogram column (one per hop), length `stored_bins`.
    /// Serialized to a JS `number[]`; the canvas reads it as a fresh column.
    pub col_db: Vec<f32>,

    // --- coherence ---
    /// In-progress index while a long-enough note is currently held (else null).
    pub live_coherence_index: Option<f32>,
    /// Monotonic count of completed sustained tones (>= SUSTAINED_MIN_SECS). JS
    /// watches this for increments to detect "a held tone just completed".
    pub coherence_seq: u64,
    /// Index of the last *completed* sustained tone (else null).
    pub last_coherence_index: Option<f32>,
    /// Duration (s) of that last completed tone.
    pub last_coherence_secs: f32,
    /// Vowel of that last completed tone.
    pub last_coherence_vowel: Option<String>,

    // --- five sub-metrics of the last completed tone (null if none yet) ---
    pub pitch_coherence: Option<f32>,
    pub amplitude_coherence: Option<f32>,
    pub harmonic_coherence: Option<f32>,
    pub spectral_stability: Option<f32>,
    pub resonance_match: Option<f32>,

    // --- raw natural-unit detail behind the last completed tone (null if none) ---
    pub detail_f0_cents_std: Option<f32>,
    pub detail_f0_var_st: Option<f32>,
    pub detail_mean_f0_hz: Option<f32>,
    pub detail_shimmer: Option<f32>,
    pub detail_rms_cv: Option<f32>,
    pub detail_hnr_db: Option<f32>,
    pub detail_entropy: Option<f32>,
    pub detail_flux: Option<f32>,
    pub detail_bandwidth_hz: Option<f32>,
    pub detail_vowel_conf: Option<f32>,
    pub detail_alpha_ratio_db: Option<f32>,
    pub detail_cpps_db: Option<f32>,
}

#[wasm_bindgen]
pub struct WasmAnalyzer {
    inner: Analyzer,
}

#[wasm_bindgen]
impl WasmAnalyzer {
    /// Create an Analyzer for the given capture sample rate (Hz).
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> WasmAnalyzer {
        #[cfg(feature = "panic-hook")]
        console_error_panic_hook::set_once();
        WasmAnalyzer {
            inner: Analyzer::new(sample_rate),
        }
    }

    /// Reset all per-capture state for a (possibly new) sample rate. Preserves
    /// the gate threshold (a UI setting), matching core `Analyzer::reset`.
    pub fn reset(&mut self, sample_rate: f32) {
        self.inner.reset(sample_rate);
    }

    /// Set the RMS silence-gate open threshold (dB).
    pub fn set_gate_db(&mut self, db: f32) {
        self.inner.set_gate_db(db);
    }

    /// Feed raw mono audio samples. The core drains complete `HOP`-sized hops
    /// internally and updates its latest state; we discard the per-hop outputs
    /// (snapshot polling is how JS reads state). Returns the number of hops that
    /// completed in this call (0 most calls; >=1 when a hop boundary was crossed).
    ///
    /// A JS `Float32Array` maps to `&[f32]` here (wasm-bindgen copies it into
    /// wasm memory for the call).
    pub fn push_samples(&mut self, samples: &[f32]) -> usize {
        self.inner.push_samples(samples).len()
    }

    /// Poll the latest state as a plain JS object (see `Snapshot`). Call once per
    /// animation frame. Cheap: it only copies a handful of scalars.
    pub fn snapshot(&self) -> JsValue {
        let r = self.inner.last_result();
        let coh = self.inner.last_coherence();
        let d = coh.map(|m| &m.detail);

        // RMS in dBFS, matching the core gate's own measure (rms + 1e-10 floor).
        let rms_db = 20.0 * (self.inner.current_rms() + 1e-10).log10();

        let snap = Snapshot {
            hop_index: self.inner.hop_index(),
            bin_hz: self.inner.bin_hz(),
            stored_bins: self.inner.stored_bins(),
            hops_per_sec: hops_per_sec(self.inner.sample_rate()),

            voiced: r.voiced,
            f0: r.f0,
            note: r.note.clone(),
            jitter_cents: r.jitter_cents,
            drift_cents: r.drift_cents,
            harmonic_count: r.harmonic_count,
            centroid_hz: r.centroid_hz,
            f1: r.f1,
            f2: r.f2,
            f3: r.f3,
            vowel: r.vowel.map(|c| c.to_string()),
            vowel_conf: r.vowel_conf,
            hnr_db: r.hnr_db,
            entropy: r.entropy,
            flux: r.flux,
            alpha_ratio_db: r.alpha_ratio_db,
            rms_db,
            col_db: self.inner.last_col_db().to_vec(),

            live_coherence_index: self.inner.live_coherence_index(),
            coherence_seq: self.inner.coherence_seq(),
            last_coherence_index: coh.map(|m| m.index),
            last_coherence_secs: self.inner.last_coherence_secs(),
            last_coherence_vowel: self.inner.last_coherence_vowel().map(|c| c.to_string()),

            pitch_coherence: coh.map(|m| m.pitch_coherence),
            amplitude_coherence: coh.map(|m| m.amplitude_coherence),
            harmonic_coherence: coh.map(|m| m.harmonic_coherence),
            spectral_stability: coh.map(|m| m.spectral_stability),
            resonance_match: coh.map(|m| m.resonance_match),

            detail_f0_cents_std: d.map(|d| d.f0_cents_std),
            detail_f0_var_st: d.map(|d| d.f0_var_st),
            detail_mean_f0_hz: d.map(|d| d.mean_f0_hz),
            detail_shimmer: d.and_then(|d| d.shimmer),
            detail_rms_cv: d.map(|d| d.rms_cv),
            detail_hnr_db: d.map(|d| d.hnr_db),
            detail_entropy: d.map(|d| d.entropy),
            detail_flux: d.map(|d| d.flux),
            detail_bandwidth_hz: d.and_then(|d| d.bandwidth_hz),
            detail_vowel_conf: d.map(|d| d.vowel_conf),
            detail_alpha_ratio_db: d.and_then(|d| d.alpha_ratio_db),
            detail_cpps_db: d.and_then(|d| d.cpps_db),
        };

        serde_wasm_bindgen::to_value(&snap).unwrap_or(JsValue::NULL)
    }
}
