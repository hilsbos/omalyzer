// UI rendering helpers: the scrolling spectrogram (with harmonic/formant
// overlays), the pitch-track plot, and the vowel chart.

use std::collections::VecDeque;

use eframe::egui::{self, Color32, ColorImage, Pos2, Rect, Stroke, TextureHandle, TextureOptions};

use crate::coherence::CoherenceMetrics;
use crate::colormap::colormap;

// Distinct, semi-transparent colors for the formant overlay lines.
const F1_COLOR: Color32 = Color32::from_rgb(255, 120, 120);
const F2_COLOR: Color32 = Color32::from_rgb(120, 200, 255);
const F3_COLOR: Color32 = Color32::from_rgb(180, 255, 140);

/// Draw the scrolling spectrogram into `ui`, filling the available space.
/// Returns the on-screen rectangle the spectrogram occupies so overlays can be
/// drawn in the same coordinate space.
///
/// * `spec` — dB columns, index 0 = oldest.
/// * `tex` — cached texture handle (created on first call).
/// * `bin_hz` — Hz per FFT bin.
/// * `max_freq` — top of the displayed frequency range.
/// * `db_floor` / `db_ceil` — dB range mapped through the colormap.
/// * `stored_bins` — number of bins stored per column.
#[allow(clippy::too_many_arguments)]
pub fn draw_spectrogram(
    ui: &mut egui::Ui,
    spec: &VecDeque<Vec<f32>>,
    tex: &mut Option<TextureHandle>,
    bin_hz: f32,
    max_freq: f32,
    db_floor: f32,
    db_ceil: f32,
    stored_bins: usize,
) -> Rect {
    let display_bins = ((max_freq / bin_hz) as usize).clamp(2, stored_bins.max(2));
    let w = spec.len().max(1);
    let h = display_bins;

    let mut rgb = vec![0u8; w * h * 3];
    for (x, col) in spec.iter().enumerate() {
        for y in 0..h {
            let bin = h - 1 - y; // top = highest frequency
            let db = col.get(bin).copied().unwrap_or(db_floor);
            let t = (db - db_floor) / (db_ceil - db_floor).max(1.0);
            let [r, g, b] = colormap(t);
            let idx = (y * w + x) * 3;
            rgb[idx] = r;
            rgb[idx + 1] = g;
            rgb[idx + 2] = b;
        }
    }
    let image = ColorImage::from_rgb([w, h], &rgb);
    match tex {
        Some(t) => t.set(image, TextureOptions::NEAREST),
        None => *tex = Some(ui.ctx().load_texture("spec", image, TextureOptions::NEAREST)),
    }

    let avail = ui.available_size();
    let (rect, _) = ui.allocate_exact_size(avail, egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, Color32::BLACK);
    if let Some(t) = tex {
        painter.image(
            t.id(),
            rect,
            Rect::from_min_max(Pos2::new(0.0, 0.0), Pos2::new(1.0, 1.0)),
            Color32::WHITE,
        );
    }

    // frequency gridlines + labels
    let step = if max_freq <= 600.0 {
        50.0
    } else if max_freq <= 1500.0 {
        100.0
    } else {
        500.0
    };
    let mut f = step;
    while f < max_freq {
        let y = rect.bottom() - (f / max_freq) * rect.height();
        painter.line_segment(
            [Pos2::new(rect.left(), y), Pos2::new(rect.right(), y)],
            Stroke::new(0.5, Color32::from_white_alpha(28)),
        );
        painter.text(
            Pos2::new(rect.left() + 4.0, y - 2.0),
            egui::Align2::LEFT_BOTTOM,
            format!("{f:.0} Hz"),
            egui::FontId::monospace(10.0),
            Color32::from_white_alpha(120),
        );
        f += step;
    }

    rect
}

/// Overlay harmonic tick marks (at k*f0 along the right edge) and horizontal
/// F1/F2/F3 lines onto a spectrogram already drawn at `rect`. Only frequencies
/// below `max_freq` are drawn.
#[allow(clippy::too_many_arguments)]
pub fn draw_spectrogram_overlay(
    ui: &mut egui::Ui,
    rect: Rect,
    max_freq: f32,
    f0: f32,
    f1: Option<f32>,
    f2: Option<f32>,
    f3: Option<f32>,
) {
    if max_freq <= 0.0 || !(f0 > 0.0) || rect.height() <= 0.0 {
        return;
    }
    let painter = ui.painter_at(rect);
    let y_of = |freq: f32| rect.bottom() - (freq / max_freq) * rect.height();

    // Harmonic ticks at every k*f0 along the right edge. These mark the actual
    // harmonic frequencies (k = 1..=20), independent of how many cleared the
    // noise floor — analyze()'s `count` is a non-contiguous tally, so using it
    // would place ticks on the wrong bands when low harmonics are weak.
    let tick_len = 10.0;
    for k in 1..=20usize {
        let fk = k as f32 * f0;
        if fk >= max_freq {
            break;
        }
        let y = y_of(fk);
        painter.line_segment(
            [Pos2::new(rect.right() - tick_len, y), Pos2::new(rect.right(), y)],
            Stroke::new(1.5, Color32::from_rgba_unmultiplied(255, 255, 255, 200)),
        );
    }

    // Horizontal formant lines (thin, semi-transparent) with small labels.
    let draw_formant = |freq: Option<f32>, color: Color32, label: &str| {
        if let Some(fv) = freq {
            if fv > 0.0 && fv < max_freq {
                let y = y_of(fv);
                let stroke_color = color.gamma_multiply(0.65);
                painter.line_segment(
                    [Pos2::new(rect.left(), y), Pos2::new(rect.right() - 12.0, y)],
                    Stroke::new(1.5, stroke_color),
                );
                painter.text(
                    Pos2::new(rect.right() - 14.0, y),
                    egui::Align2::RIGHT_CENTER,
                    label,
                    egui::FontId::monospace(10.0),
                    color,
                );
            }
        }
    };
    draw_formant(f1, F1_COLOR, "F1");
    draw_formant(f2, F2_COLOR, "F2");
    draw_formant(f3, F3_COLOR, "F3");
}

/// Draw the pitch track: voiced F0 over the last ~60 s, log-frequency y-axis
/// with faint semitone gridlines and octave note labels. Flat line = stable.
pub fn draw_pitch_track(
    ui: &mut egui::Ui,
    rect: Rect,
    history: &VecDeque<(u64, f32)>,
    latest_hop: u64,
) {
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 2.0, Color32::from_gray(18));
    painter.rect_stroke(
        rect,
        2.0,
        Stroke::new(1.0, Color32::from_gray(60)),
        egui::StrokeKind::Inside,
    );

    let title_h = 14.0;
    let plot = Rect::from_min_max(
        Pos2::new(rect.left() + 34.0, rect.top() + title_h),
        Pos2::new(rect.right() - 4.0, rect.bottom() - 4.0),
    );
    painter.text(
        Pos2::new(rect.left() + 6.0, rect.top() + 2.0),
        egui::Align2::LEFT_TOP,
        "pitch track (60 s)",
        egui::FontId::monospace(11.0),
        Color32::from_white_alpha(160),
    );

    if plot.width() <= 0.0 || plot.height() <= 0.0 {
        return;
    }

    // Frequency range: fit history with padding, clamped to the chant range.
    let (mut fmin, mut fmax) = (f32::INFINITY, f32::NEG_INFINITY);
    for &(_, f) in history.iter() {
        if f > 0.0 {
            fmin = fmin.min(f);
            fmax = fmax.max(f);
        }
    }
    if !fmin.is_finite() || !fmax.is_finite() {
        // Empty history: show a default chant range so gridlines still render.
        fmin = 100.0;
        fmax = 400.0;
    }
    // Pad by a few semitones and clamp.
    fmin = (fmin / 1.12).max(65.0);
    fmax = (fmax * 1.12).min(550.0);
    if fmax <= fmin * 1.05 {
        fmax = fmin * 1.5;
    }

    let lf_min = fmin.ln();
    let lf_max = fmax.ln();
    let y_of = |f: f32| {
        let t = (f.max(1.0).ln() - lf_min) / (lf_max - lf_min);
        plot.bottom() - t.clamp(0.0, 1.0) * plot.height()
    };

    // Semitone gridlines; label note names roughly every octave.
    const NOTE_NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    let midi_lo = (69.0 + 12.0 * (fmin / 440.0).log2()).ceil() as i32;
    let midi_hi = (69.0 + 12.0 * (fmax / 440.0).log2()).floor() as i32;
    for midi in midi_lo..=midi_hi {
        let f = 440.0 * 2f32.powf((midi - 69) as f32 / 12.0);
        let y = y_of(f);
        let is_octave = midi.rem_euclid(12) == 0; // C notes
        let alpha = if is_octave { 60 } else { 22 };
        painter.line_segment(
            [Pos2::new(plot.left(), y), Pos2::new(plot.right(), y)],
            Stroke::new(0.5, Color32::from_white_alpha(alpha)),
        );
        if is_octave {
            let name = NOTE_NAMES[midi.rem_euclid(12) as usize];
            let octave = midi.div_euclid(12) - 1;
            painter.text(
                Pos2::new(rect.left() + 4.0, y),
                egui::Align2::LEFT_CENTER,
                format!("{name}{octave}"),
                egui::FontId::monospace(9.0),
                Color32::from_white_alpha(140),
            );
        }
    }

    if history.is_empty() {
        return;
    }

    // Time axis: latest_hop on the right, 60 s window to the left.
    let span = (plot.width()).max(1.0);
    // Map hop -> x. Use the visible history span (oldest..latest).
    let oldest = history.front().map(|&(h, _)| h).unwrap_or(latest_hop);
    let window_hops = (latest_hop.saturating_sub(oldest)).max(1) as f32;
    let x_of = |hop: u64| {
        let dt = latest_hop.saturating_sub(hop) as f32; // hops before now
        plot.right() - (dt / window_hops) * span
    };

    // Line plot of f0; break the line across large hop gaps (unvoiced spans).
    let mut prev: Option<(f32, f32, u64)> = None;
    for &(hop, f) in history.iter() {
        if f <= 0.0 {
            continue;
        }
        let p = (x_of(hop), y_of(f));
        if let Some((px, py, ph)) = prev {
            // Only connect contiguous voiced frames.
            if hop.saturating_sub(ph) <= 2 {
                painter.line_segment(
                    [Pos2::new(px, py), Pos2::new(p.0, p.1)],
                    Stroke::new(1.5, Color32::from_rgb(120, 220, 140)),
                );
            }
        }
        prev = Some((p.0, p.1, hop));
    }
}

/// Draw the vowel chart: a conventional vowel trapezoid with F2 DECREASING
/// left-to-right (reversed) and F1 INCREASING downward. Reference targets are
/// faint labeled circles; the live point at (f1, f2) shows a short fading trail.
pub fn draw_vowel_chart(
    ui: &mut egui::Ui,
    rect: Rect,
    history: &VecDeque<(u64, f32, f32)>,
    latest_hop: u64,
    hops_per_sec: f32,
    live: (Option<f32>, Option<f32>),
) {
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 2.0, Color32::from_gray(18));
    painter.rect_stroke(
        rect,
        2.0,
        Stroke::new(1.0, Color32::from_gray(60)),
        egui::StrokeKind::Inside,
    );
    painter.text(
        Pos2::new(rect.left() + 6.0, rect.top() + 2.0),
        egui::Align2::LEFT_TOP,
        "vowel chart",
        egui::FontId::monospace(11.0),
        Color32::from_white_alpha(160),
    );

    let plot = Rect::from_min_max(
        Pos2::new(rect.left() + 8.0, rect.top() + 18.0),
        Pos2::new(rect.right() - 8.0, rect.bottom() - 8.0),
    );
    if plot.width() <= 0.0 || plot.height() <= 0.0 {
        return;
    }

    // Axis ranges (Hz). F2 on X (reversed: high F2 at left), F1 on Y (down).
    let f2_lo = 700.0f32; // appears at RIGHT
    let f2_hi = 2600.0f32; // appears at LEFT
    let f1_lo = 250.0f32; // appears at TOP
    let f1_hi = 850.0f32; // appears at BOTTOM

    let x_of = |f2: f32| {
        let t = (f2.clamp(f2_lo, f2_hi) - f2_lo) / (f2_hi - f2_lo);
        // reversed: high F2 -> left
        plot.right() - t * plot.width()
    };
    let y_of = |f1: f32| {
        let t = (f1.clamp(f1_lo, f1_hi) - f1_lo) / (f1_hi - f1_lo);
        // F1 increases downward
        plot.top() + t * plot.height()
    };

    // Axis hints.
    // F2 is reversed on X (high at left, low at right), so the arrows point the
    // way F2 actually changes across the axis.
    painter.text(
        Pos2::new(plot.left() + 2.0, plot.bottom() - 1.0),
        egui::Align2::LEFT_BOTTOM,
        "(high) ←F2",
        egui::FontId::monospace(8.0),
        Color32::from_white_alpha(90),
    );
    painter.text(
        Pos2::new(plot.right() - 2.0, plot.bottom() - 1.0),
        egui::Align2::RIGHT_BOTTOM,
        "F2→ (low)",
        egui::FontId::monospace(8.0),
        Color32::from_white_alpha(90),
    );

    // Reference vowel targets (same as classifier).
    const TARGETS: [(char, f32, f32); 5] = [
        ('i', 300.0, 2300.0),
        ('e', 530.0, 1850.0),
        ('a', 700.0, 1200.0),
        ('o', 500.0, 900.0),
        ('u', 350.0, 800.0),
    ];
    for &(v, f1, f2) in TARGETS.iter() {
        let c = Pos2::new(x_of(f2), y_of(f1));
        painter.circle_stroke(c, 12.0, Stroke::new(1.0, Color32::from_white_alpha(60)));
        painter.text(
            c,
            egui::Align2::CENTER_CENTER,
            v.to_string(),
            egui::FontId::monospace(12.0),
            Color32::from_white_alpha(150),
        );
    }

    // Fading trail over the last ~2 s.
    let trail_hops = (hops_per_sec * 2.0).max(1.0) as u64;
    let trail_start = latest_hop.saturating_sub(trail_hops);
    for &(hop, f1, f2) in history.iter() {
        if hop < trail_start || f1 <= 0.0 || f2 <= 0.0 {
            continue;
        }
        let age = latest_hop.saturating_sub(hop) as f32 / trail_hops as f32;
        let alpha = ((1.0 - age) * 140.0) as u8;
        let p = Pos2::new(x_of(f2), y_of(f1));
        painter.circle_filled(p, 2.5, Color32::from_rgba_unmultiplied(255, 210, 90, alpha));
    }

    // Live dot.
    if let (Some(f1), Some(f2)) = live {
        if f1 > 0.0 && f2 > 0.0 {
            let p = Pos2::new(x_of(f2), y_of(f1));
            painter.circle_filled(p, 4.5, Color32::from_rgb(255, 230, 120));
            painter.circle_stroke(p, 4.5, Stroke::new(1.0, Color32::BLACK));
        }
    }
}

/// Draw the Vocal Coherence section: the overall index as a labeled bar plus the
/// five acoustic sub-metrics, each with its 0..1 score, a bar, and the raw
/// measurement that drove it (F0 wander, shimmer, HNR, etc.). Hover any row for a
/// one-line description. Honest acoustic framing (docs section 4.4) — the header
/// names the measured vowel and duration; sub-labels are the acoustic constructs
/// (pitch / amplitude / harmonic / spectral / resonance), never energetic /
/// chakra language. Absent values collapse to an em-dash, matching the monospace
/// readout style of the top panel.
///
/// * `metrics` — the last completed sustained tone's metrics (`None` until one
///   has been captured).
/// * `vowel` / `secs` — which vowel and how many seconds it was measured over.
/// * `live_index` — a cheap in-progress index while a note is currently held.
pub fn draw_coherence_panel(
    ui: &mut egui::Ui,
    metrics: Option<&CoherenceMetrics>,
    vowel: Option<char>,
    secs: f32,
    live_index: Option<f32>,
) {
    let dash = "—";

    // Header: "Vocal Coherence (sustained /x/, N s)" with a live-hold hint.
    let header = match (metrics, vowel) {
        (Some(_), Some(v)) => format!("Vocal Coherence (sustained /{v}/, {secs:.1} s)"),
        (Some(_), None) => format!("Vocal Coherence (sustained tone, {secs:.1} s)"),
        (None, _) => "Vocal Coherence (sustained tone) — hold a steady note ≥ 2.5 s".to_string(),
    };
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(header)
                .monospace()
                .size(13.0)
                .strong(),
        )
        .on_hover_text(
            "Overall vocal coherence and its five acoustic sub-metrics, measured \
             over the last steady tone you held (≥ 2.5 s). Each score is 0..1, \
             higher = steadier / clearer / more ordered. A within-person acoustic \
             measure, not a diagnosis.",
        );
        if let Some(li) = live_index {
            ui.label(
                egui::RichText::new(format!("· holding… {li:.2}"))
                    .monospace()
                    .size(12.0)
                    .color(Color32::from_rgb(40, 150, 70)),
            )
            .on_hover_text("Live in-progress index while you hold the current note.");
        }
    });

    // Scale legend (only meaningful once a tone has been captured).
    if metrics.is_some() {
        ui.label(
            egui::RichText::new("  0 = unstable / noisy   …   1 = steady / clear")
                .monospace()
                .size(10.0)
                .weak(),
        );
    }

    // D4: an honest scope note. The index reflects vocal-production steadiness
    // only; it is NOT a nervous-system, arousal, or health reading.
    ui.label(
        egui::RichText::new(
            "  reflects vocal-production steadiness — no nervous-system claim",
        )
        .monospace()
        .size(10.0)
        .weak(),
    );

    // Overall index as a prominent bar.
    let index = metrics.map(|m| m.index);
    ui.horizontal(|ui| {
        let label = match index {
            Some(i) => format!("index {i:.2}"),
            None => format!("index {dash:>4}"),
        };
        ui.label(egui::RichText::new(format!("{label:<11}")).monospace().size(14.0))
            .on_hover_text(
                "Weighted overall index: 0.25·pitch + 0.15·amplitude + 0.30·harmonic \
                 + 0.15·spectral + 0.15·resonance.",
            );
        coherence_bar(ui, index, 240.0, 14.0);
    });

    // The five sub-metrics: name + 0..1 score + bar + raw measurement, each with
    // a hover description. The raw text is the natural-unit value behind the score.
    let d = metrics.map(|m| m.detail);
    sub_metric(
        ui,
        "pitch",
        metrics.map(|m| m.pitch_coherence),
        d.map(|d| format!("F0 ±{:.0} c", d.f0_cents_std)),
        "Pitch steadiness — how little F0 wandered across the held tone (cents std-dev). Lower wander → higher score.",
    );
    sub_metric(
        ui,
        "amplitude",
        metrics.map(|m| m.amplitude_coherence),
        d.map(|d| match d.shimmer {
            Some(sh) => format!("shimmer {:.1}%", sh * 100.0),
            None => format!("RMS cv {:.2}", d.rms_cv),
        }),
        "Loudness steadiness — cycle-to-cycle amplitude variation (shimmer), or RMS variation when shimmer isn't measurable.",
    );
    sub_metric(
        ui,
        "harmonic",
        metrics.map(|m| m.harmonic_coherence),
        d.map(|d| format!("HNR {:.0} dB · entropy {:.2}", d.hnr_db, d.entropy)),
        "Harmonic clarity — harmonics-to-noise ratio plus spectral order (low entropy = clean, ordered harmonics).",
    );
    sub_metric(
        ui,
        "spectral",
        metrics.map(|m| m.spectral_stability),
        d.map(|d| format!("flux {:.3}", d.flux)),
        "Spectral stability — how little the spectrum changed frame-to-frame (flux). Lower flux → higher score.",
    );
    sub_metric(
        ui,
        "resonance",
        metrics.map(|m| m.resonance_match),
        d.map(|d| match d.bandwidth_hz {
            Some(bw) => format!("vowel {:.0}% · bw {:.0} Hz", d.vowel_conf * 100.0, bw),
            None => format!("vowel {:.0}%", d.vowel_conf * 100.0),
        }),
        "Resonance support — how cleanly the vowel matched a target and how sharp (narrow-bandwidth) the formants were.",
    );
}

/// Evidence tiers for the state-signals readout (Appendix 1). The colored dot
/// before each metric encodes how strong the within-person evidence is.
#[derive(Clone, Copy)]
enum Evidence {
    /// Strong, well-established acoustic correlate.
    Strong,
    /// Moderate / context-dependent correlate.
    Moderate,
    /// Experimental / deferred (e.g. needs a baseline we do not keep).
    Experimental,
}

impl Evidence {
    /// A legible dot color for this tier (fixed hues; readable on the panel).
    fn dot_color(self) -> Color32 {
        match self {
            Evidence::Strong => Color32::from_rgb(60, 170, 90), // green
            Evidence::Moderate => Color32::from_rgb(210, 160, 40), // amber
            Evidence::Experimental => Color32::from_rgb(140, 140, 140), // grey
        }
    }
}

/// State-signals block for the coherence panel: the last completed sustained
/// tone's raw acoustic measurements (F0 mean, F0 variability, alpha-ratio,
/// CPPS) plus the deferred Autonomic Index placeholder.
///
/// CRITICAL FRAMING: every row here is a RAW MEASUREMENT, never a state
/// inference. There is no personal baseline in this build, so nothing is
/// presented as a population-referenced or absolute state — the heading and the
/// measured|inferred divider make that separation explicit, and each tooltip
/// says the value "will become a within-person signal once a baseline exists".
/// The Autonomic Index is rendered as a deferred experimental placeholder
/// ("needs baseline"), never a number or a state word.
pub fn draw_state_signals_panel(ui: &mut egui::Ui, metrics: Option<&CoherenceMetrics>) {
    let dash = "—";
    let d = metrics.map(|m| m.detail);

    // Heading: honest measured/inferred separation, no baseline claim.
    ui.label(
        egui::RichText::new("State signals (raw — needs a personal baseline to interpret)")
            .monospace()
            .size(12.0)
            .strong(),
    )
    .on_hover_text(
        "Raw acoustic measurements from your last steady tone. They are shown on \
         the MEASURED side of the line: with no personal baseline this build never \
         turns them into a state, population comparison, or any nervous-system / \
         health reading. Each becomes a within-person signal only once a baseline \
         exists.",
    );
    ui.label(
        egui::RichText::new("  measured │ inferred (needs baseline)")
            .monospace()
            .size(10.0)
            .weak(),
    );

    // F0 mean (Hz) — strong evidence.
    state_signal_row(
        ui,
        Evidence::Strong,
        "F0 mean",
        d.map(|d| format!("{:>6.1} Hz", d.mean_f0_hz)),
        "Average fundamental frequency over the held tone (Hz) — a raw measurement. \
         It will become a within-person signal once a baseline exists; on its own it \
         is not a state, mood, or health reading.",
    );

    // F0 variability (semitones) — moderate evidence.
    state_signal_row(
        ui,
        Evidence::Moderate,
        "F0 var",
        d.map(|d| format!("{:>6.2} st", d.f0_var_st)),
        "How much F0 wandered across the held tone, in semitones — a raw measurement \
         of vocal-production steadiness. It will become a within-person signal once a \
         baseline exists; it makes no nervous-system claim.",
    );

    // Alpha-ratio (dB) — moderate evidence.
    state_signal_row(
        ui,
        Evidence::Moderate,
        "α-ratio",
        d.and_then(|d| d.alpha_ratio_db).map(|a| format!("{a:>+6.1} dB")),
        "Spectral tilt (low vs high band energy) averaged over the held tone, in dB — \
         a raw measurement. It will become a within-person signal once a baseline \
         exists; shown here only as a measured acoustic, not a state.",
    );

    // CPPS (dB) — moderate evidence.
    state_signal_row(
        ui,
        Evidence::Moderate,
        "CPPS",
        d.and_then(|d| d.cpps_db).map(|c| format!("{c:>6.1} dB")),
        "Smoothed cepstral peak prominence over the held tone, in dB — a raw measure \
         of harmonic clarity / periodicity. It will become a within-person signal once \
         a baseline exists; it is not a diagnosis.",
    );

    // Autonomic Index — experimental, deferred: NOT a number, NOT a state word.
    ui.horizontal(|ui| {
        let weak = ui.visuals().weak_text_color();
        ui.label(
            egui::RichText::new("●")
                .size(11.0)
                .color(Evidence::Experimental.dot_color()),
        );
        ui.label(
            egui::RichText::new(format!("{:<8} ", "Auto idx"))
                .monospace()
                .size(12.0),
        );
        ui.label(
            egui::RichText::new("⚗ needs baseline")
                .monospace()
                .size(11.0)
                .italics()
                .color(weak),
        )
        .on_hover_text(
            "Experimental, deferred. An autonomic index would require a personal \
             baseline centroid (a Mahalanobis distance from it) that this build does \
             not keep — so no number and no state word is shown. It is a placeholder \
             only, never a nervous-system or health reading.",
        );
    });

    // Blank-to-dash hint when there is no completed tone yet.
    if metrics.is_none() {
        ui.label(
            egui::RichText::new(format!("  {dash} hold a steady note ≥ 2.5 s for state signals"))
                .monospace()
                .size(10.0)
                .weak(),
        );
    }
}

/// One state-signal row: evidence dot + name + raw measurement (em-dash when
/// absent), with a hover tooltip. The value is always a raw measurement — the
/// tooltip must not claim any state inference or baseline comparison.
fn state_signal_row(
    ui: &mut egui::Ui,
    evidence: Evidence,
    name: &str,
    raw: Option<String>,
    tooltip: &str,
) {
    let dash = "—";
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("●")
                .size(11.0)
                .color(evidence.dot_color()),
        );
        ui.label(
            egui::RichText::new(format!("{name:<8} "))
                .monospace()
                .size(12.0),
        )
        .on_hover_text(tooltip);
        let value = raw.unwrap_or_else(|| format!("{dash:>6}"));
        ui.label(
            egui::RichText::new(value)
                .monospace()
                .size(12.0),
        )
        .on_hover_text(tooltip);
    });
}

/// One sub-metric row: `name` + 0..1 score + bar + raw measurement, with a hover
/// description. Absent score / raw collapse to an em-dash.
fn sub_metric(
    ui: &mut egui::Ui,
    name: &str,
    value: Option<f32>,
    raw: Option<String>,
    description: &str,
) {
    let dash = "—";
    ui.horizontal(|ui| {
        let val = match value {
            Some(x) => format!("{x:.2}"),
            None => format!("{dash:>4}"),
        };
        ui.label(
            egui::RichText::new(format!("{name:<10} {val}"))
                .monospace()
                .size(12.0),
        )
        .on_hover_text(description);
        coherence_bar(ui, value, 160.0, 9.0);
        ui.label(
            egui::RichText::new(raw.unwrap_or_else(|| dash.to_string()))
                .monospace()
                .size(11.0)
                .weak(),
        )
        .on_hover_text(description);
    });
}

/// A small horizontal 0..1 bar. `value = None` draws only the empty track.
fn coherence_bar(ui: &mut egui::Ui, value: Option<f32>, width: f32, height: f32) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 2.0, Color32::from_gray(30));
    painter.rect_stroke(
        rect,
        2.0,
        Stroke::new(1.0, Color32::from_gray(60)),
        egui::StrokeKind::Inside,
    );
    if let Some(v) = value {
        let t = v.clamp(0.0, 1.0);
        let fill = Rect::from_min_size(rect.min, egui::vec2(rect.width() * t, rect.height()));
        // Red (low) -> amber -> green (high), so the color reinforces the value.
        let color = if t < 0.5 {
            let k = (t / 0.5).clamp(0.0, 1.0);
            Color32::from_rgb(220, (90.0 + 120.0 * k) as u8, 70)
        } else {
            let k = ((t - 0.5) / 0.5).clamp(0.0, 1.0);
            Color32::from_rgb((220.0 - 100.0 * k) as u8, 210, (70.0 + 50.0 * k) as u8)
        };
        painter.rect_filled(fill, 2.0, color);
    }
}
