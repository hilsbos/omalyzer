// Omalyzer Live — real-time vowel-chant analyzer.
//
// Captures a macOS input device and shows a scrolling low-frequency
// spectrogram. Per-hop analysis (pitch, harmonics, formants, voice quality)
// runs behind an RMS silence gate; results are surfaced in the top panel.

mod analysis;
mod audio;
mod coherence;
mod colormap;
mod formants;
mod harmonics;
mod pitch;
mod spectral;
mod ui;
mod voice_quality;

use std::collections::VecDeque;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;

use eframe::egui::{self, Color32, TextureHandle};
use rustfft::{num_complex::Complex, Fft, FftPlanner};

use audio::{list_input_devices, start_audio};
use pitch::PitchTracker;

const FFT_SIZE: usize = 16384; // ~2.7-2.9 Hz bins at 44.1/48 kHz
const HOP: usize = 4096; // ~11 spectral frames per second
const SPEC_COLS: usize = 512; // spectrogram history (~45 s)
const STORE_MAX_HZ: f32 = 4000.0; // store bins up to this frequency (spectrogram)
// Harmonic/HNR analysis needs the full harmonic range: up to 20 harmonics of a
// chant fundamental (e.g. 20 * 440 Hz) and a 0-5 kHz noise-floor median, so the
// analysis spectrum is kept wider than the displayed spectrogram.
const ANALYSIS_MAX_HZ: f32 = 9000.0;
/// Minimum continuously-held duration (seconds) before a sustained tone is
/// considered long enough to capture a Vocal Coherence Index for.
const SUSTAINED_MIN_SECS: f32 = 2.5;
/// Cap on the held-note time-domain buffer used for the one segment-level
/// shimmer measurement (~6 s at 48 kHz), so a long hold stays cheap.
const HELD_SAMPLES_MAX: usize = 288_000;

/// Approximate analysis hops per second (sample_rate / HOP, ~11–12 at
/// 44.1/48 kHz). Used to size the pitch tracker's time windows.
fn hops_per_sec(sample_rate: f32) -> f32 {
    (sample_rate / HOP as f32).max(1.0)
}

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1100.0, 760.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Omalyzer Live",
        options,
        Box::new(|_cc| Ok(Box::new(App::new()))),
    )
}

// ---------------------------------------------------------------- app

struct App {
    rx: Receiver<Vec<f32>>,
    _stream: Option<cpal::Stream>,
    sample_rate: f32,
    device_name: String,
    devices: Vec<String>,
    error: Option<String>,

    // DSP state
    pending: Vec<f32>,
    window: VecDeque<f32>,
    hann: Vec<f32>,
    fft: Arc<dyn Fft<f32>>,
    stored_bins: usize,   // bins kept per spectrogram column (up to STORE_MAX_HZ)
    analysis_bins: usize, // bins kept in latest_lin for analysis (up to ANALYSIS_MAX_HZ)
    spec: VecDeque<Vec<f32>>, // dB columns, index 0 = oldest
    latest_lin: Vec<f32>,     // latest linear (window-normalized) magnitude column
    prev_lin: Vec<f32>,       // previous frame's linear magnitude column (for flux)
    current_rms: f32,         // most recent per-hop RMS amplitude
    gate_open: bool,          // current gate state (hysteresis between hops)
    gate_hold: u32,           // remaining release-hold hops before closing

    // analysis
    last_result: analysis::AnalysisResult,
    tracker: PitchTracker,
    hop_index: u64,
    // (hop_index, f0) for voiced frames, ~60 s, for the pitch-track plot.
    pitch_history: VecDeque<(u64, f32)>,
    // (hop_index, f1, f2) for voiced+formant frames, for the vowel-chart trail.
    vowel_history: VecDeque<(u64, f32, f32)>,

    // Sustained-tone coherence capture.
    // The currently-held note's accumulating feature segment (`Some` while a
    // continuously voiced note is held), plus the onset hop of that held note so
    // we can detect when it changes (= a new note).
    held_segment: Option<coherence::SustainedSegment>,
    held_onset: Option<u64>,
    // Most-confident vowel observed during the current held note (by confidence).
    held_vowel: Option<char>,
    held_vowel_conf: f32,
    // Time-domain samples of the current held note, for one segment-level shimmer
    // measurement when the note ends. Bounded so a very long hold stays cheap.
    held_samples: Vec<f32>,
    held_f0_sum: f32, // running sum of held-note F0 for a representative f0
    held_f0_n: u32,
    // Result of the last completed sustained tone (None until one is captured).
    last_coherence: Option<coherence::CoherenceMetrics>,
    last_coherence_vowel: Option<char>,
    last_coherence_secs: f32,
    // Cheap live in-progress index while a note is being held (None otherwise).
    live_coherence_index: Option<f32>,

    // UI state
    paused: bool,
    max_freq: f32,
    db_floor: f32,
    db_ceil: f32,
    gate_db: f32,
    tex: Option<TextureHandle>,
}

impl App {
    fn new() -> Self {
        let (tx, rx) = channel();
        let (stream, sample_rate, device_name, error) = match start_audio(tx, None) {
            Ok((s, sr, name)) => (Some(s), sr, name, None),
            Err(e) => (None, 48000.0, String::new(), Some(e)),
        };
        let devices = list_input_devices();
        let hann: Vec<f32> = (0..FFT_SIZE)
            .map(|n| 0.5 - 0.5 * (std::f32::consts::TAU * n as f32 / (FFT_SIZE - 1) as f32).cos())
            .collect();
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let bin_hz = sample_rate / FFT_SIZE as f32;
        let stored_bins = ((STORE_MAX_HZ / bin_hz) as usize).min(FFT_SIZE / 2);
        let analysis_bins = ((ANALYSIS_MAX_HZ / bin_hz) as usize).min(FFT_SIZE / 2);

        Self {
            rx,
            _stream: stream,
            sample_rate,
            device_name,
            devices,
            error,
            pending: Vec::new(),
            window: VecDeque::with_capacity(FFT_SIZE),
            hann,
            fft,
            stored_bins,
            analysis_bins,
            spec: VecDeque::with_capacity(SPEC_COLS),
            latest_lin: Vec::new(),
            prev_lin: Vec::new(),
            current_rms: 0.0,
            gate_open: false,
            gate_hold: 0,
            last_result: analysis::AnalysisResult::default(),
            tracker: PitchTracker::new(hops_per_sec(sample_rate)),
            hop_index: 0,
            pitch_history: VecDeque::new(),
            vowel_history: VecDeque::new(),
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
            paused: false,
            max_freq: 1000.0,
            db_floor: -90.0,
            db_ceil: -30.0,
            gate_db: -45.0,
            tex: None,
        }
    }

    /// Tear down the current stream and capture from the named device instead.
    fn switch_device(&mut self, name: &str) {
        self._stream = None; // drop the old stream first
        let (tx, rx) = channel();
        self.rx = rx;
        match start_audio(tx, Some(name)) {
            Ok((stream, sample_rate, device_name)) => {
                self._stream = Some(stream);
                self.sample_rate = sample_rate;
                self.device_name = device_name;
                self.error = None;
                // sample-rate-dependent state
                let bin_hz = sample_rate / FFT_SIZE as f32;
                self.stored_bins = ((STORE_MAX_HZ / bin_hz) as usize).min(FFT_SIZE / 2);
                self.analysis_bins = ((ANALYSIS_MAX_HZ / bin_hz) as usize).min(FFT_SIZE / 2);
            }
            Err(e) => self.error = Some(e),
        }
        // reset DSP/display state so old data doesn't mix with the new device
        self.pending.clear();
        self.window.clear();
        self.spec.clear();
        self.latest_lin.clear();
        self.prev_lin.clear();
        self.current_rms = 0.0;
        self.gate_open = false;
        self.gate_hold = 0;
        self.last_result = analysis::AnalysisResult::default();
        // Rebuild pitch state from scratch at the (possibly new) hop rate so
        // stale F0 history from the old device can't leak into jitter/drift.
        self.tracker = PitchTracker::new(hops_per_sec(self.sample_rate));
        self.hop_index = 0;
        self.pitch_history.clear();
        self.vowel_history.clear();
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
        self.tex = None;
    }

    fn bin_hz(&self) -> f32 {
        self.sample_rate / FFT_SIZE as f32
    }

    fn ingest_audio(&mut self) {
        while let Ok(chunk) = self.rx.try_recv() {
            if !self.paused {
                self.pending.extend(chunk);
            }
        }
        while self.pending.len() >= HOP {
            let hop: Vec<f32> = self.pending.drain(..HOP).collect();

            self.current_rms = (hop.iter().map(|s| s * s).sum::<f32>() / HOP as f32).sqrt();

            self.window.extend(hop);
            while self.window.len() > FFT_SIZE {
                self.window.pop_front();
            }
            if self.window.len() == FFT_SIZE {
                // Carry the prior spectrum forward for spectral flux before
                // push_spectrum_column overwrites latest_lin with this frame.
                self.prev_lin.clear();
                self.prev_lin.extend_from_slice(&self.latest_lin);
                self.push_spectrum_column();

                // RMS silence gate with hysteresis + release hold so signals
                // hovering near the threshold (decay tails, vibrato troughs,
                // breath) do not flicker the readouts between values and dashes.
                // Open at gate_db; once open, stay open until rms drops a margin
                // below it, then keep open for a few more hops (release hold).
                const GATE_HYST_DB: f32 = 4.0; // close threshold sits this far below open
                const GATE_RELEASE_HOPS: u32 = 4; // ~0.35 s hold before declaring silence
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
                let win: Vec<f32> = self.window.iter().copied().collect();
                let hop_index = self.hop_index;
                self.hop_index = self.hop_index.wrapping_add(1);
                let result = analysis::run(
                    &win,
                    &self.prev_lin,
                    &self.latest_lin,
                    self.sample_rate,
                    self.bin_hz(),
                    gate_open,
                    hop_index,
                    &mut self.tracker,
                );

                // Plot histories: voiced frames only, bounded to ~60 s.
                let cap = (hops_per_sec(self.sample_rate) * 60.0).ceil() as usize;
                if result.voiced {
                    if let Some(f0) = result.f0 {
                        self.pitch_history.push_back((hop_index, f0));
                    }
                    if let (Some(f1), Some(f2)) = (result.f1, result.f2) {
                        self.vowel_history.push_back((hop_index, f1, f2));
                    }
                }
                while self.pitch_history.len() > cap {
                    self.pitch_history.pop_front();
                }
                while self.vowel_history.len() > cap {
                    self.vowel_history.pop_front();
                }

                // Sustained-tone coherence capture (held-note state machine).
                let onset = self.tracker.onset();
                self.update_sustained_capture(&result, &win, onset);

                self.last_result = result;
            }
        }
    }

    fn push_spectrum_column(&mut self) {
        let win_sum: f32 = self.hann.iter().sum();
        let mut buf: Vec<Complex<f32>> = self
            .window
            .iter()
            .zip(&self.hann)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        self.fft.process(&mut buf);

        // Wide window-normalized linear magnitudes (up to ANALYSIS_MAX_HZ) kept
        // for harmonic/HNR analysis: harmonics up to 20*f0 and the 0-5 kHz noise
        // floor must lie inside this slice, so it extends past the spectrogram.
        let lin: Vec<f32> = buf[..self.analysis_bins]
            .iter()
            .map(|c| 2.0 * c.norm() / win_sum)
            .collect();
        // The spectrogram only displays up to STORE_MAX_HZ, so its dB column is
        // the truncated prefix of the linear spectrum.
        let col: Vec<f32> = lin[..self.stored_bins.min(lin.len())]
            .iter()
            .map(|m| 20.0 * (m + 1e-10).log10())
            .collect();
        self.latest_lin = lin;

        self.spec.push_back(col);
        while self.spec.len() > SPEC_COLS {
            self.spec.pop_front();
        }
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
        result: &analysis::AnalysisResult,
        win: &[f32],
        onset: Option<u64>,
    ) {
        let hps = hops_per_sec(self.sample_rate);
        let rms = self.current_rms;

        // Continuation only when voiced AND the onset matches the held note.
        let continues =
            result.voiced && matches!((onset, self.held_onset), (Some(a), Some(b)) if a == b);

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
            // Same note held: accumulate this hop (take/put-back keeps the field
            // borrows disjoint while we also touch the other held-note fields).
            Self::push_hop_features(&mut seg, result, rms);
            self.held_segment = Some(seg);
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
    fn push_hop_features(
        seg: &mut coherence::SustainedSegment,
        r: &analysis::AnalysisResult,
        rms: f32,
    ) {
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

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.ingest_audio();

        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.heading("Omalyzer Live");
                ui.separator();
                let mut switch_to: Option<String> = None;
                egui::ComboBox::from_id_salt("input_device")
                    .selected_text(if self.device_name.is_empty() {
                        "select input…"
                    } else {
                        &self.device_name
                    })
                    .width(220.0)
                    .show_ui(ui, |ui| {
                        for name in &self.devices {
                            if ui
                                .selectable_label(*name == self.device_name, name)
                                .clicked()
                                && *name != self.device_name
                            {
                                switch_to = Some(name.clone());
                            }
                        }
                    });
                if ui
                    .button("⟳")
                    .on_hover_text("rescan input devices")
                    .clicked()
                {
                    self.devices = list_input_devices();
                }
                if let Some(name) = switch_to {
                    self.switch_device(&name);
                }
                if let Some(err) = &self.error {
                    ui.colored_label(Color32::LIGHT_RED, err);
                    return;
                }
                ui.label(format!("@ {:.1} kHz", self.sample_rate / 1000.0));
                ui.separator();
                if ui
                    .button(if self.paused { "▶ resume" } else { "⏸ pause" })
                    .clicked()
                {
                    self.paused = !self.paused;
                }
            });
            ui.add_space(2.0);

            // Two readout rows. Monospace, fixed-width fields so the layout
            // does not reflow between voiced and unvoiced frames; every field
            // collapses to an em-dash placeholder when the value is absent.
            let r = &self.last_result;
            let voiced = r.voiced;
            let dash = "—";

            // Row 1: vowel + confidence · F0/note · jitter/drift.
            ui.horizontal(|ui| {
                let vowel = match (voiced, r.vowel) {
                    (true, Some(c)) => format!("{c} ({:>3.0}%)", r.vowel_conf * 100.0),
                    _ => format!("{dash:>8}"),
                };
                let f0 = match (voiced, r.f0) {
                    (true, Some(f)) => {
                        format!("{f:>6.1} Hz {:<9}", r.note.clone().unwrap_or_default())
                    }
                    _ => format!("{dash:>19}"),
                };
                let jitter = match (voiced, r.jitter_cents) {
                    (true, Some(j)) => format!("{j:>4.0}c"),
                    _ => format!("{dash:>5}"),
                };
                let drift = match (voiced, r.drift_cents) {
                    (true, Some(d)) => format!("{d:>+5.0}c"),
                    _ => format!("{dash:>6}"),
                };
                ui.label(
                    egui::RichText::new(format!(
                        "vowel: {vowel}   F0: {f0}   jitter: {jitter} drift: {drift}"
                    ))
                    .monospace()
                    .size(15.0),
                );
            });

            // Row 2: harmonics count + centroid · F1/F2/F3 · HNR.
            ui.horizontal(|ui| {
                let harm = if voiced {
                    format!("{:>2}", r.harmonic_count)
                } else {
                    format!("{dash:>2}")
                };
                let centroid = if voiced && r.centroid_hz > 0.0 {
                    format!("{:.1} kHz", r.centroid_hz / 1000.0)
                } else {
                    format!("{dash:>7}")
                };
                let fmt = |o: Option<f32>| -> String {
                    match (voiced, o) {
                        (true, Some(v)) => format!("{v:>4.0}"),
                        _ => format!("{dash:>4}"),
                    }
                };
                let hnr = match (voiced, r.hnr_db) {
                    (true, Some(h)) => format!("{h:>3.0} dB"),
                    _ => format!("{dash:>6}"),
                };
                ui.label(
                    egui::RichText::new(format!(
                        "harmonics: {harm} · centroid {centroid}   F1 {} F2 {} F3 {}   HNR: {hnr}",
                        fmt(r.f1),
                        fmt(r.f2),
                        fmt(r.f3),
                    ))
                    .monospace()
                    .size(15.0),
                );
                // Alpha ratio (spectral tilt) — a measured acoustic shown raw.
                // It is research-linked to vocal effort/arousal, but is only
                // interpretable as *state* relative to a personal baseline, which
                // this build does not yet keep — so it is shown as a measurement,
                // not a state reading (honest-framing guardrail).
                let alpha = match (voiced, r.alpha_ratio_db) {
                    (true, Some(a)) => format!("{a:>+5.1} dB"),
                    _ => format!("{dash:>6}"),
                };
                ui.label(
                    egui::RichText::new(format!("   α-ratio: {alpha}"))
                        .monospace()
                        .size(15.0),
                )
                .on_hover_text(
                    "Spectral tilt: balance of low (50–1000 Hz) vs high (1000–5000 Hz) \
                     energy, in dB. A measured acoustic that research links to vocal \
                     effort/arousal — shown raw here; it becomes a meaningful state \
                     signal only as a change vs your own baseline (not yet tracked).",
                );
            });
            ui.add_space(4.0);
            ui.separator();
            ui::draw_coherence_panel(
                ui,
                self.last_coherence.as_ref(),
                self.last_coherence_vowel,
                self.last_coherence_secs,
                self.live_coherence_index,
            );
            ui.add_space(2.0);
            ui::draw_state_signals_panel(ui, self.last_coherence.as_ref());
            ui.add_space(2.0);
            ui.separator();
            ui.horizontal(|ui| {
                ui.label("max freq");
                ui.add(
                    egui::Slider::new(&mut self.max_freq, 200.0..=STORE_MAX_HZ)
                        .suffix(" Hz")
                        .logarithmic(true),
                );
                ui.separator();
                ui.label("floor");
                ui.add(egui::Slider::new(&mut self.db_floor, -120.0..=-50.0).suffix(" dB"));
                ui.label("ceil");
                ui.add(egui::Slider::new(&mut self.db_ceil, -60.0..=0.0).suffix(" dB"));
                ui.separator();
                ui.label("gate");
                ui.add(egui::Slider::new(&mut self.gate_db, -60.0..=-30.0).suffix(" dB"));
            });
            ui.add_space(4.0);
        });

        let bin_hz = self.bin_hz();

        // Bottom panel: pitch track (left) + vowel chart (right).
        egui::TopBottomPanel::bottom("analysis_plots")
            .exact_height(170.0)
            .show(ctx, |ui| {
                let full = ui.available_rect_before_wrap();
                let gap = 8.0;
                let half = (full.width() - gap) * 0.5;
                let left = egui::Rect::from_min_size(full.min, egui::vec2(half, full.height()));
                let right = egui::Rect::from_min_size(
                    egui::pos2(full.min.x + half + gap, full.min.y),
                    egui::vec2(half, full.height()),
                );
                ui::draw_pitch_track(ui, left, &self.pitch_history, self.hop_index);
                ui::draw_vowel_chart(
                    ui,
                    right,
                    &self.vowel_history,
                    self.hop_index,
                    hops_per_sec(self.sample_rate),
                    if self.last_result.voiced {
                        (self.last_result.f1, self.last_result.f2)
                    } else {
                        (None, None)
                    },
                );
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            let spec_rect = ui::draw_spectrogram(
                ui,
                &self.spec,
                &mut self.tex,
                bin_hz,
                self.max_freq,
                self.db_floor,
                self.db_ceil,
                self.stored_bins,
            );
            // Overlay harmonic ticks and formant lines when voiced.
            let r = &self.last_result;
            if r.voiced {
                if let Some(f0) = r.f0 {
                    ui::draw_spectrogram_overlay(
                        ui,
                        spec_rect,
                        self.max_freq,
                        f0,
                        r.f1,
                        r.f2,
                        r.f3,
                    );
                }
            }
        });

        ctx.request_repaint(); // continuous updates
    }
}
