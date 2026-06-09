//! omalyzer-wasm — a thin wasm-bindgen shim over `omalyzer_core::Analyzer`.
//! It owns NO DSP: it drives the core Analyzer and copies its latest state into
//! a flat `Snapshot` for JS. The browser's AudioWorklet feeds whole hops via
//! `push_samples`; the render loop polls `snapshot()` per frame.

use omalyzer_core::Analyzer;
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
    // --- live per-hop readout (from last_result) ---
    pub voiced: bool,
    pub f0: Option<f32>,
    pub note: Option<String>,
    pub vowel: Option<String>,
    pub vowel_conf: f32,
    pub hnr_db: Option<f32>,
    /// Most-recent per-hop RMS amplitude, in dBFS.
    pub rms_db: f32,

    // --- coherence ---
    /// In-progress index while a long-enough note is currently held (else null).
    pub live_coherence_index: Option<f32>,
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

        // RMS in dBFS, matching the core gate's own measure (rms + 1e-10 floor).
        let rms_db = 20.0 * (self.inner.current_rms() + 1e-10).log10();

        let snap = Snapshot {
            voiced: r.voiced,
            f0: r.f0,
            note: r.note.clone(),
            vowel: r.vowel.map(|c| c.to_string()),
            vowel_conf: r.vowel_conf,
            hnr_db: r.hnr_db,
            rms_db,

            live_coherence_index: self.inner.live_coherence_index(),
            last_coherence_index: coh.map(|m| m.index),
            last_coherence_secs: self.inner.last_coherence_secs(),
            last_coherence_vowel: self.inner.last_coherence_vowel().map(|c| c.to_string()),

            pitch_coherence: coh.map(|m| m.pitch_coherence),
            amplitude_coherence: coh.map(|m| m.amplitude_coherence),
            harmonic_coherence: coh.map(|m| m.harmonic_coherence),
            spectral_stability: coh.map(|m| m.spectral_stability),
            resonance_match: coh.map(|m| m.resonance_match),
        };

        serde_wasm_bindgen::to_value(&snap).unwrap_or(JsValue::NULL)
    }
}
