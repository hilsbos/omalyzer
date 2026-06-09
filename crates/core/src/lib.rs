// omalyzer-core — std-only DSP modules plus the core Analyzer that owns the
// FFT, hop/window/RMS-gate framing, and the sustained-tone/coherence capture
// state machine. No audio device or GUI dependency; the only non-std dependency
// is rustfft (pure Rust, used by `fft`/`analyzer`). The eight DSP modules below
// stay std-only and unit-testable.

pub mod analysis;
pub mod coherence;
pub mod colormap;
pub mod formants;
pub mod harmonics;
pub mod pitch;
pub mod spectral;
pub mod voice_quality;

pub mod analyzer;
mod fft;
pub mod framing;

pub use analysis::AnalysisResult;
pub use analyzer::{Analyzer, HopOutput};
pub use coherence::{CoherenceDetail, CoherenceMetrics};
pub use framing::hops_per_sec;
