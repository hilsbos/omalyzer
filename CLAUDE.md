# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Omalyzer is a real-time vowel-chant analyzer: `live/` is a Rust crate (`omalyzer-live`), a macOS desktop app (eframe/egui) that captures microphone input and shows a scrolling low-frequency spectrogram plus per-hop voice analysis (pitch, harmonics, formants, vowel classification, jitter/drift, HNR) and a per-sustained-tone Vocal Coherence Index. `recordings/` is gitignored scratch space for audio files.

`docs/vocal-nervous-system-analysis.md` is the research grounding (voice → autonomic state; the §5.2 coherence definitions and §3 feature toolbox the DSP implements) — read it before changing detection/coherence logic. It also marks which claims are established vs. speculative, and the honest-framing rules for the UI (§4.4): report acoustic deviations, never energetic/chakra diagnoses.

## Commands

Run from `live/`:

```sh
cargo run --release        # build & launch the app (needs mic permission)
cargo test                 # unit tests (DSP modules: pitch, formants, harmonics)
cargo test pitch::         # tests for a single module
cargo check                # fast type-check
```

## Architecture (live/)

Dataflow per frame: `audio.rs` (cpal input stream) → mpsc channel → `App::ingest_audio` in `main.rs`, which slices audio into 4096-sample hops, maintains a 16384-sample FFT window, and pushes spectrogram columns. Per-hop analysis runs behind an RMS silence gate with hysteresis + release hold (see `main.rs`).

- `main.rs` — app state, DSP constants (`FFT_SIZE`, `HOP`, `STORE_MAX_HZ` for display vs `ANALYSIS_MAX_HZ` for the wider analysis spectrum), gate logic, plot histories, and the sustained-tone capture state machine (`update_sustained_capture` / `finish_held_note`).
- `analysis.rs` — per-hop orchestrator combining the modules below into one `AnalysisResult` (incl. spectral entropy/flux and mean formant bandwidth).
- `pitch.rs` — YIN F0 estimation, note naming, `PitchTracker` (jitter = short-term cents std-dev, drift = slow cents change of the held note).
- `formants.rs` — LPC formant estimation (decimate → pre-emphasis → autocorrelation → Levinson-Durbin → envelope peak-pick), −3 dB formant bandwidths, and vowel classification.
- `harmonics.rs` — harmonic peak extraction, spectral centroid, HNR (Praat normalized-autocorrelation method).
- `spectral.rs` — spectral entropy, flatness, flux, and alpha ratio (spectral tilt, eGeMAPS bands) on a linear magnitude spectrum.
- `voice_quality.rs` — shimmer, CPP (cepstral peak prominence), H1–H2. (`cpp`/`h1_h2_db`/`spectral_flatness` are validated and tested but not yet wired into the readout — `#[allow(dead_code)]`.)
- `coherence.rs` — `SustainedSegment` (per-hop feature accumulator) + `compute` → the Vocal Coherence Index (five 0..1 sub-metrics + weighted overall), per docs §5.2. Mapping thresholds are defaults, to be baseline-normalized per person later (§5.3).
- `ui.rs` / `colormap.rs` — spectrogram + overlays, pitch-track plot, vowel chart, coherence panel.

Design convention: DSP modules (`pitch`, `formants`, `harmonics`, `spectral`, `voice_quality`, `coherence`) are pure functions on slices — std-only, no audio device or egui dependency — so they stay unit-testable. Keep new DSP code in that style; only `audio.rs` touches cpal and only `ui.rs`/`main.rs` touch egui.

Note: the FFT analysis spectrum (`latest_lin`) is wider than the displayed spectrogram because harmonic/HNR analysis needs up to 20·F0 and a 0–5 kHz noise-floor median; don't truncate it to the display range.
