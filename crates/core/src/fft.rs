// FFT/Hann machinery extracted from the desktop app's push_spectrum_column.
// Owns the rustfft plan plus reusable scratch buffers so the per-hop spectrum
// allocates nothing beyond its two output Vecs. rustfft is the only non-std
// dependency in core; it is pure Rust (no device/GUI), so unit-testability and
// wasm portability are preserved.

use std::collections::VecDeque;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

use crate::framing::FFT_SIZE;

pub struct FftMachine {
    fft: Arc<dyn Fft<f32>>,
    fft_scratch: Vec<Complex<f32>>, // reused FFT input buffer per hop
    hann: Vec<f32>,
    hann_sum: f32, // cached sum of `hann` (window-normalization denominator)
}

impl FftMachine {
    pub fn new() -> Self {
        let hann: Vec<f32> = (0..FFT_SIZE)
            .map(|n| 0.5 - 0.5 * (std::f32::consts::TAU * n as f32 / (FFT_SIZE - 1) as f32).cos())
            .collect();
        let hann_sum: f32 = hann.iter().sum();
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        Self {
            fft,
            fft_scratch: Vec::with_capacity(FFT_SIZE),
            hann,
            hann_sum,
        }
    }

    /// Compute one window-normalized linear magnitude spectrum (up to
    /// `analysis_bins`) plus its truncated dB spectrogram column (up to
    /// `stored_bins`). Mirrors the original push_spectrum_column exactly:
    /// complex buf = s*w over window.zip(hann); fft.process; lin = 2*norm/sum;
    /// col = 20*log10(m + 1e-10) over the truncated prefix.
    pub fn spectrum(
        &mut self,
        window: &VecDeque<f32>,
        analysis_bins: usize,
        stored_bins: usize,
    ) -> (Vec<f32>, Vec<f32>) {
        let win_sum = self.hann_sum; // invariant: cached at construction
        let mut buf = std::mem::take(&mut self.fft_scratch);
        buf.clear();
        buf.extend(
            window
                .iter()
                .zip(&self.hann)
                .map(|(s, w)| Complex::new(s * w, 0.0)),
        );
        self.fft.process(&mut buf);

        // Wide window-normalized linear magnitudes (up to ANALYSIS_MAX_HZ) kept
        // for harmonic/HNR analysis: harmonics up to 20*f0 and the 0-5 kHz noise
        // floor must lie inside this slice, so it extends past the spectrogram.
        let lin: Vec<f32> = buf[..analysis_bins]
            .iter()
            .map(|c| 2.0 * c.norm() / win_sum)
            .collect();
        // The spectrogram only displays up to STORE_MAX_HZ, so its dB column is
        // the truncated prefix of the linear spectrum.
        let col: Vec<f32> = lin[..stored_bins.min(lin.len())]
            .iter()
            .map(|m| 20.0 * (m + 1e-10).log10())
            .collect();

        // Return the FFT buffer for reuse on the next hop.
        self.fft_scratch = buf;

        (lin, col)
    }
}
