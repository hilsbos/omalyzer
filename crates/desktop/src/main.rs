// Omalyzer Live — real-time vowel-chant analyzer.
//
// Captures a macOS input device and shows a scrolling low-frequency
// spectrogram. Per-hop analysis (pitch, harmonics, formants, voice quality)
// runs behind an RMS silence gate; results are surfaced in the top panel.
//
// All DSP lives in the `omalyzer-core` crate; this binary is a thin consumer
// that owns the cpal capture, the eframe UI, and the display-only state
// (spectrogram ring, plot histories). It feeds raw samples to `core::Analyzer`
// and rebuilds its display state from the per-hop outputs.

mod audio;
mod ui;

use std::collections::VecDeque;
use std::sync::mpsc::{channel, Receiver};

use eframe::egui::{self, Color32, TextureHandle};

use audio::{list_input_devices, start_audio};
use omalyzer_core::{hops_per_sec, AnalysisResult, Analyzer};

const SPEC_COLS: usize = 512; // spectrogram history (~45 s)
const STORE_MAX_HZ: f32 = 4000.0; // store/display bins up to this frequency

/// Default RMS silence-gate threshold (dB); mirrored into the core analyzer.
const DEFAULT_GATE_DB: f32 = -45.0;

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

    // Core DSP/analysis (owns FFT, framing, gate, coherence capture).
    analyzer: Analyzer,

    // Display state rebuilt from the analyzer's per-hop outputs.
    spec: VecDeque<Vec<f32>>, // dB columns, index 0 = oldest
    // (hop_index, f0) for voiced frames, ~60 s, for the pitch-track plot.
    pitch_history: VecDeque<(u64, f32)>,
    // (hop_index, f1, f2) for voiced+formant frames, for the vowel-chart trail.
    vowel_history: VecDeque<(u64, f32, f32)>,

    // UI state
    paused: bool,
    max_freq: f32,
    db_floor: f32,
    db_ceil: f32,
    gate_db: f32, // UI-mirror of the core gate threshold
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
        let mut analyzer = Analyzer::new(sample_rate);
        analyzer.set_gate_db(DEFAULT_GATE_DB);

        Self {
            rx,
            _stream: stream,
            sample_rate,
            device_name,
            devices,
            error,
            analyzer,
            spec: VecDeque::with_capacity(SPEC_COLS),
            pitch_history: VecDeque::new(),
            vowel_history: VecDeque::new(),
            paused: false,
            max_freq: 1000.0,
            db_floor: -90.0,
            db_ceil: -30.0,
            gate_db: DEFAULT_GATE_DB,
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
            }
            Err(e) => self.error = Some(e),
        }
        // Reset core DSP state for the (possibly new) sample rate. Preserves the
        // gate threshold (a UI setting), so re-mirror it is unnecessary.
        self.analyzer.reset(self.sample_rate);
        // Reset display state so old data doesn't mix with the new device.
        self.spec.clear();
        self.pitch_history.clear();
        self.vowel_history.clear();
        self.tex = None;
    }

    fn ingest_audio(&mut self) {
        let mut buf: Vec<f32> = Vec::new();
        while let Ok(chunk) = self.rx.try_recv() {
            if !self.paused {
                buf.extend_from_slice(&chunk);
            }
        }
        if buf.is_empty() {
            return;
        }

        // Plot histories: voiced frames only, bounded to ~60 s.
        let cap = (hops_per_sec(self.sample_rate) * 60.0).ceil() as usize;

        for hop in self.analyzer.push_samples(&buf) {
            self.spec.push_back(hop.col_db);
            while self.spec.len() > SPEC_COLS {
                self.spec.pop_front();
            }

            if hop.voiced {
                if let Some(f0) = hop.f0 {
                    self.pitch_history.push_back((hop.hop_index, f0));
                }
                if let (Some(f1), Some(f2)) = (hop.f1, hop.f2) {
                    self.vowel_history.push_back((hop.hop_index, f1, f2));
                }
            }
            while self.pitch_history.len() > cap {
                self.pitch_history.pop_front();
            }
            while self.vowel_history.len() > cap {
                self.vowel_history.pop_front();
            }
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
            let r: &AnalysisResult = self.analyzer.last_result();
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
                self.analyzer.last_coherence(),
                self.analyzer.last_coherence_vowel(),
                self.analyzer.last_coherence_secs(),
                self.analyzer.live_coherence_index(),
            );
            ui.add_space(2.0);
            ui::draw_state_signals_panel(ui, self.analyzer.last_coherence());
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
                if ui
                    .add(egui::Slider::new(&mut self.gate_db, -60.0..=-30.0).suffix(" dB"))
                    .changed()
                {
                    self.analyzer.set_gate_db(self.gate_db);
                }
            });
            ui.add_space(4.0);
        });

        let bin_hz = self.analyzer.bin_hz();

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
                let hop_index = self.analyzer.hop_index();
                ui::draw_pitch_track(ui, left, &self.pitch_history, hop_index);
                let last = self.analyzer.last_result();
                let cur = if last.voiced {
                    (last.f1, last.f2)
                } else {
                    (None, None)
                };
                ui::draw_vowel_chart(
                    ui,
                    right,
                    &self.vowel_history,
                    hop_index,
                    hops_per_sec(self.sample_rate),
                    cur,
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
                self.analyzer.stored_bins(),
            );
            // Overlay harmonic ticks and formant lines when voiced.
            let r = self.analyzer.last_result();
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
