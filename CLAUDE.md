# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Omalyzer is a real-time vowel-chant analyzer: `live/` is a Rust crate (`omalyzer-live`), a macOS desktop app (eframe/egui) that captures microphone input and shows a scrolling low-frequency spectrogram plus per-hop voice analysis (pitch, harmonics, formants, vowel classification, jitter/drift, HNR). `recordings/` is gitignored scratch space for audio files.

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

- `main.rs` — app state, DSP constants (`FFT_SIZE`, `HOP`, `STORE_MAX_HZ` for display vs `ANALYSIS_MAX_HZ` for the wider analysis spectrum), gate logic, plot histories.
- `analysis.rs` — per-hop orchestrator combining the modules below into one `AnalysisResult`.
- `pitch.rs` — YIN F0 estimation, note naming, `PitchTracker` (jitter = short-term cents std-dev, drift = slow cents change of the held note).
- `formants.rs` — LPC formant estimation (decimate → pre-emphasis → autocorrelation → Levinson-Durbin → envelope peak-pick) and vowel classification.
- `harmonics.rs` — harmonic peak extraction, spectral centroid, HNR (Praat normalized-autocorrelation method).
- `ui.rs` / `colormap.rs` — spectrogram + overlays, pitch-track plot, vowel chart.

Design convention: DSP modules (`pitch`, `formants`, `harmonics`) are pure functions on slices — std-only, no audio device or egui dependency — so they stay unit-testable. Keep new DSP code in that style; only `audio.rs` touches cpal and only `ui.rs`/`main.rs` touch egui.

Note: the FFT analysis spectrum (`latest_lin`) is wider than the displayed spectrogram because harmonic/HNR analysis needs up to 20·F0 and a 0–5 kHz noise-floor median; don't truncate it to the display range.
