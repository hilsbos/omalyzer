// The core Analyzer: owns the FFT, the hop/window/RMS-gate framing, and the
// sustained-tone/coherence capture state machine. Consumers feed it raw audio
// samples via `push_samples` and receive one `HopOutput` per completed analysis
// hop, from which they can rebuild a spectrogram ring and plot histories. All
// behavior is lifted verbatim from the original desktop app so it stays
// bit-for-bit identical.

use std::collections::VecDeque;

use crate::analysis::{self, AnalysisResult};
use crate::coherence::{self, CoherenceMetrics};
use crate::fft::FftMachine;
use crate::framing::{
    ANALYSIS_MAX_HZ, FFT_SIZE, GATE_HYST_DB, GATE_RELEASE_HOPS, HELD_SAMPLES_MAX, HOP,
    STORE_MAX_HZ, SUSTAINED_MIN_SECS, bin_hz, hops_per_sec,
};
use crate::pitch::PitchTracker;
use crate::voice_quality;

/// Default RMS silence-gate threshold (dB), matching the desktop app's default.
const DEFAULT_GATE_DB: f32 = -45.0;

/// One completed analysis hop's outputs. Consumers ring `col_db` into their
/// spectrogram history and, when `voiced`, push (`hop_index`, f0)/(f1,f2) into
/// their plot trails.
pub struct HopOutput {
    pub hop_index: u64,
    pub voiced: bool,
    pub f0: Option<f32>,
    pub f1: Option<f32>,
    pub f2: Option<f32>,
    pub result: AnalysisResult,
    /// dB spectrogram column truncated to `stored_bins` (STORE_MAX_HZ).
    pub col_db: Vec<f32>,
}

pub struct Analyzer {
    sample_rate: f32,

    // DSP framing state.
    pending: Vec<f32>,
    window: VecDeque<f32>,
    fft: FftMachine,
    win_scratch: Vec<f32>, // reused contiguous copy of `window` per hop
    stored_bins: usize,    // bins kept per spectrogram column (up to STORE_MAX_HZ)
    analysis_bins: usize,  // bins kept in latest_lin for analysis (up to ANALYSIS_MAX_HZ)
    latest_lin: Vec<f32>,  // latest linear (window-normalized) magnitude column
    prev_lin: Vec<f32>,    // previous frame's linear magnitude column (for flux)
    current_rms: f32,      // most recent per-hop RMS amplitude
    gate_open: bool,       // current gate state (hysteresis between hops)
    gate_hold: u32,        // remaining release-hold hops before closing
    gate_db: f32,          // gate open threshold (UI param; preserved across reset)

    // Analysis.
    last_result: AnalysisResult,
    tracker: PitchTracker,
    hop_index: u64,

    // Sustained-tone coherence capture.
    held_segment: Option<coherence::SustainedSegment>,
    held_onset: Option<u64>,
    held_vowel: Option<char>,
    held_vowel_conf: f32,
    held_samples: Vec<f32>,
    held_f0_sum: f32,
    held_f0_n: u32,
    last_coherence: Option<CoherenceMetrics>,
    last_coherence_vowel: Option<char>,
    last_coherence_secs: f32,
    live_coherence_index: Option<f32>,
}

impl Analyzer {
    pub fn new(sample_rate: f32) -> Self {
        let bh = bin_hz(sample_rate);
        let stored_bins = ((STORE_MAX_HZ / bh) as usize).min(FFT_SIZE / 2);
        let analysis_bins = ((ANALYSIS_MAX_HZ / bh) as usize).min(FFT_SIZE / 2);
        Self {
            sample_rate,
            pending: Vec::new(),
            window: VecDeque::with_capacity(FFT_SIZE),
            fft: FftMachine::new(),
            win_scratch: Vec::with_capacity(FFT_SIZE),
            stored_bins,
            analysis_bins,
            latest_lin: Vec::new(),
            prev_lin: Vec::new(),
            current_rms: 0.0,
            gate_open: false,
            gate_hold: 0,
            gate_db: DEFAULT_GATE_DB,
            last_result: AnalysisResult::default(),
            tracker: PitchTracker::new(hops_per_sec(sample_rate)),
            hop_index: 0,
            held_segment: None,
            held_onset: None,
            held_vowel: None,
            held_vowel_conf: 0.0,
            held_samples: Vec::new(),
            held_f0_sum: 0.0,
            held_f0_n: 0,
            last_coherence: None,
            last_coherence_vowel: None,
            last_coherence_secs: 0.0,
            live_coherence_index: None,
        }
    }

    /// Reset all per-capture state for a (possibly new) sample rate. Mirrors the
    /// desktop switch_device reset block. Preserves `gate_db` (a UI setting).
    pub fn reset(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        let bh = bin_hz(sample_rate);
        self.stored_bins = ((STORE_MAX_HZ / bh) as usize).min(FFT_SIZE / 2);
        self.analysis_bins = ((ANALYSIS_MAX_HZ / bh) as usize).min(FFT_SIZE / 2);
        self.pending.clear();
        self.window.clear();
        self.latest_lin.clear();
        self.prev_lin.clear();
        self.current_rms = 0.0;
        self.gate_open = false;
        self.gate_hold = 0;
        self.last_result = AnalysisResult::default();
        // Rebuild pitch state from scratch at the (possibly new) hop rate so
        // stale F0 history from the old device can't leak into jitter/drift.
        self.tracker = PitchTracker::new(hops_per_sec(self.sample_rate));
        self.hop_index = 0;
        // Drop any in-progress / completed sustained-tone capture.
        self.held_segment = None;
        self.held_onset = None;
        self.held_vowel = None;
        self.held_vowel_conf = 0.0;
        self.held_samples.clear();
        self.held_f0_sum = 0.0;
        self.held_f0_n = 0;
        self.last_coherence = None;
        self.last_coherence_vowel = None;
        self.last_coherence_secs = 0.0;
        self.live_coherence_index = None;
    }

    /// Set the RMS silence-gate open threshold (dB) the hysteresis reads.
    pub fn set_gate_db(&mut self, db: f32) {
        self.gate_db = db;
    }

    /// Feed raw audio samples and return one `HopOutput` per completed analysis
    /// hop. Non-finite samples are sanitized to silence at this boundary so a
    /// single driver-glitch NaN/inf can never wedge the silence gate.
    pub fn push_samples(&mut self, samples: &[f32]) -> Vec<HopOutput> {
        let mut out = Vec::new();
        // Sanitize device input: a single NaN/inf sample (driver glitch) would
        // make current_rms NaN, and every gate comparison with `>` is false for
        // NaN — wedging the silence gate (a closed gate never reopens). Replace
        // non-finite samples with silence.
        self.pending
            .extend(samples.iter().map(|&s| if s.is_finite() { s } else { 0.0 }));

        while self.pending.len() >= HOP {
            let hop: Vec<f32> = self.pending.drain(..HOP).collect();

            self.current_rms = (hop.iter().map(|s| s * s).sum::<f32>() / HOP as f32).sqrt();

            self.window.extend(hop);
            while self.window.len() > FFT_SIZE {
                self.window.pop_front();
            }
            if self.window.len() == FFT_SIZE {
                // Carry the prior spectrum forward for spectral flux before the
                // new spectrum overwrites latest_lin with this frame.
                self.prev_lin.clear();
                self.prev_lin.extend_from_slice(&self.latest_lin);
                let (lin, col) =
                    self.fft
                        .spectrum(&self.window, self.analysis_bins, self.stored_bins);
                self.latest_lin = lin;

                // RMS silence gate with hysteresis + release hold so signals
                // hovering near the threshold (decay tails, vibrato troughs,
                // breath) do not flicker the readouts between values and dashes.
                // Open at gate_db; once open, stay open until rms drops a margin
                // below it, then keep open for a few more hops (release hold).
                let rms_db = 20.0 * (self.current_rms + 1e-10).log10();
                if self.gate_open {
                    if rms_db > self.gate_db - GATE_HYST_DB {
                        self.gate_hold = GATE_RELEASE_HOPS;
                    } else if self.gate_hold > 0 {
                        self.gate_hold -= 1;
                    } else {
                        self.gate_open = false;
                    }
                } else if rms_db > self.gate_db {
                    self.gate_open = true;
                    self.gate_hold = GATE_RELEASE_HOPS;
                }
                let gate_open = self.gate_open;
                // Reuse a persistent contiguous scratch copy of the window
                // (VecDeque isn't contiguous) instead of allocating ~64 KB/hop.
                self.win_scratch.clear();
                self.win_scratch.extend(self.window.iter().copied());
                let win = std::mem::take(&mut self.win_scratch);
                let hop_index = self.hop_index;
                self.hop_index = self.hop_index.wrapping_add(1);
                let result = analysis::run(
                    &win,
                    &self.prev_lin,
                    &self.latest_lin,
                    self.sample_rate,
                    bin_hz(self.sample_rate),
                    gate_open,
                    hop_index,
                    &mut self.tracker,
                );

                // Sustained-tone coherence capture (held-note state machine).
                let onset = self.tracker.onset();
                self.update_sustained_capture(&result, &win, onset);

                // Return the scratch buffer for reuse on the next hop.
                self.win_scratch = win;
                self.last_result = result.clone();

                out.push(HopOutput {
                    hop_index,
                    voiced: result.voiced,
                    f0: result.f0,
                    f1: result.f1,
                    f2: result.f2,
                    result,
                    col_db: col,
                });
            }
        }
        out
    }

    pub fn last_result(&self) -> &AnalysisResult {
        &self.last_result
    }

    pub fn last_coherence(&self) -> Option<&CoherenceMetrics> {
        self.last_coherence.as_ref()
    }

    pub fn last_coherence_vowel(&self) -> Option<char> {
        self.last_coherence_vowel
    }

    pub fn last_coherence_secs(&self) -> f32 {
        self.last_coherence_secs
    }

    pub fn live_coherence_index(&self) -> Option<f32> {
        self.live_coherence_index
    }

    pub fn current_rms(&self) -> f32 {
        self.current_rms
    }

    pub fn stored_bins(&self) -> usize {
        self.stored_bins
    }

    pub fn bin_hz(&self) -> f32 {
        bin_hz(self.sample_rate)
    }

    pub fn hop_index(&self) -> u64 {
        self.hop_index
    }

    /// Advance the sustained-tone capture state machine for one analysis hop.
    ///
    /// A "held note" is a run of continuously voiced hops sharing the same pitch
    /// onset (the `PitchTracker` resets the onset on an unvoiced gap or a >150c
    /// jump). While a note is held we accumulate per-hop features into a
    /// `coherence::SustainedSegment` and buffer time-domain samples for one
    /// segment-level shimmer measurement. When the note ends (onset changes or
    /// the frame is unvoiced) we finalize and store the Vocal Coherence Index if
    /// the hold lasted at least `SUSTAINED_MIN_SECS`.
    fn update_sustained_capture(
        &mut self,
        result: &AnalysisResult,
        win: &[f32],
        onset: Option<u64>,
    ) {
        let hps = hops_per_sec(self.sample_rate);
        let rms = self.current_rms;

        // Continuation is keyed to the SAME onset signal the `PitchTracker`
        // exposes, which itself tolerates up to 3 consecutive unvoiced hops
        // before clearing the onset (vibrato troughs, breath, brief YIN/gate
        // dropouts). So a held note continues whenever the tracker's onset is
        // unchanged — even on a momentarily-unvoiced hop — and only finalizes
        // when the onset actually changes or becomes `None`. (Keying off
        // `result.voiced` instead would chop a genuinely continuous hold into
        // sub-segments on a single transient dropout.)
        let continues = matches!((onset, self.held_onset), (Some(a), Some(b)) if a == b);

        if !continues {
            // The previous held note (if any) just ended; finalize it.
            self.finish_held_note();

            // Start a fresh segment if this frame is voiced with a known onset.
            if result.voiced {
                if let (Some(on), Some(f0)) = (onset, result.f0) {
                    let mut seg = coherence::SustainedSegment::new(hps);
                    Self::push_hop_features(&mut seg, result, rms);
                    self.held_segment = Some(seg);
                    self.held_onset = Some(on);
                    self.held_vowel = result.vowel;
                    self.held_vowel_conf = result.vowel_conf;
                    self.held_samples.clear();
                    Self::append_held_samples(&mut self.held_samples, win);
                    self.held_f0_sum = f0;
                    self.held_f0_n = 1;
                }
            }
        } else if let Some(mut seg) = self.held_segment.take() {
            // Same note held. A momentarily-unvoiced hop (tracker still within
            // its 3-None tolerance) does NOT end the note: we simply skip
            // pushing this hop's features/samples (they carry no valid F0 /
            // would corrupt the segment) and resume on the next voiced hop.
            if result.voiced {
                Self::push_hop_features(&mut seg, result, rms);
                if result.vowel_conf > self.held_vowel_conf {
                    self.held_vowel = result.vowel;
                    self.held_vowel_conf = result.vowel_conf;
                }
                Self::append_held_samples(&mut self.held_samples, win);
                if let Some(f0) = result.f0 {
                    self.held_f0_sum += f0;
                    self.held_f0_n += 1;
                }
            }
            self.held_segment = Some(seg);
        }

        // Cheap live in-progress index while a long-enough note is held.
        self.live_coherence_index = self
            .held_segment
            .as_ref()
            .filter(|s| s.duration_secs() >= SUSTAINED_MIN_SECS)
            .and_then(coherence::compute)
            .map(|m| m.index);
    }

    /// Finalize the currently-held note: compute the one segment-level shimmer,
    /// then the Vocal Coherence Index, storing it when the hold was long enough.
    /// Clears the held-note state regardless.
    fn finish_held_note(&mut self) {
        if let Some(mut seg) = self.held_segment.take() {
            if seg.duration_secs() >= SUSTAINED_MIN_SECS && self.held_f0_n > 0 {
                let f0 = self.held_f0_sum / self.held_f0_n as f32;
                let shimmer = voice_quality::shimmer(&self.held_samples, self.sample_rate, f0);
                seg.set_shimmer(shimmer);
                // Smoothed cepstral peak prominence over the whole held window —
                // a raw within-person measurement that also feeds the harmonic
                // sub-metric. Computed before compute() so both reflect it.
                let cpps = voice_quality::cpps(&self.held_samples, self.sample_rate, f0);
                seg.set_cpps(cpps);
                if let Some(metrics) = coherence::compute(&seg) {
                    self.last_coherence = Some(metrics);
                    self.last_coherence_vowel = self.held_vowel;
                    self.last_coherence_secs = seg.duration_secs();
                }
            }
        }
        self.held_onset = None;
        self.held_vowel = None;
        self.held_vowel_conf = 0.0;
        self.held_samples.clear();
        self.held_f0_sum = 0.0;
        self.held_f0_n = 0;
        self.live_coherence_index = None;
    }

    /// Push one analysis hop's features (plus the hop's RMS) into a segment.
    fn push_hop_features(seg: &mut coherence::SustainedSegment, r: &AnalysisResult, rms: f32) {
        seg.push_hop(
            r.f0.unwrap_or(0.0),
            rms,
            r.hnr_db,
            r.entropy,
            r.flux,
            r.mean_formant_bw,
            r.vowel_conf,
            r.alpha_ratio_db,
        );
    }

    /// Append the current hop's time-domain samples (the most recent `HOP`
    /// samples of the window) to the held-note buffer, bounded by
    /// `HELD_SAMPLES_MAX`.
    fn append_held_samples(buf: &mut Vec<f32>, win: &[f32]) {
        let start = win.len().saturating_sub(HOP);
        buf.extend_from_slice(&win[start..]);
        if buf.len() > HELD_SAMPLES_MAX {
            let excess = buf.len() - HELD_SAMPLES_MAX;
            buf.drain(..excess);
        }
    }
}
