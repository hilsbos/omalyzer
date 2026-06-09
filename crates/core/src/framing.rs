// Framing/DSP constants shared by the core Analyzer. These define the hop and
// FFT geometry, the analysis bandwidth, the sustained-tone capture timing, and
// the RMS silence-gate hysteresis. Moved verbatim from the desktop app so every
// consumer (desktop, future wasm) frames audio identically.

/// FFT window length in samples (~2.7-2.9 Hz bins at 44.1/48 kHz).
pub const FFT_SIZE: usize = 16384;
/// Hop size in samples (~11 spectral frames per second).
pub const HOP: usize = 4096;
/// Store/display spectrogram bins up to this frequency (Hz). The dB column
/// emitted to consumers is truncated to this band.
pub const STORE_MAX_HZ: f32 = 4000.0;
/// Harmonic/HNR analysis needs the full harmonic range (up to 20 harmonics of a
/// chant fundamental and a 0-5 kHz noise-floor median), so the analysis
/// spectrum is kept wider than the displayed spectrogram.
pub const ANALYSIS_MAX_HZ: f32 = 9000.0;
/// Minimum continuously-held duration (seconds) before a sustained tone is
/// considered long enough to capture a Vocal Coherence Index for.
pub const SUSTAINED_MIN_SECS: f32 = 2.5;
/// Cap on the held-note time-domain buffer used for the one segment-level
/// shimmer/CPPS measurement (~6 s at 48 kHz), so a long hold stays cheap.
pub const HELD_SAMPLES_MAX: usize = 288_000;
/// Silence-gate close threshold sits this many dB below the open threshold.
pub const GATE_HYST_DB: f32 = 4.0;
/// Hops to keep the gate open after the signal drops below close (~0.35 s).
pub const GATE_RELEASE_HOPS: u32 = 4;

/// Approximate analysis hops per second (sample_rate / HOP, ~11–12 at
/// 44.1/48 kHz). Used to size the pitch tracker's time windows.
pub fn hops_per_sec(sample_rate: f32) -> f32 {
    (sample_rate / HOP as f32).max(1.0)
}

/// Hz per FFT bin for the given sample rate.
pub fn bin_hz(sample_rate: f32) -> f32 {
    sample_rate / FFT_SIZE as f32
}
