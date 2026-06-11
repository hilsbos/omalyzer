# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

omalyzer (lowercase brand) is a real-time vowel-chant analyzer: it extracts per-hop voice features (pitch, harmonics, formants, vowel, jitter/drift, HNR, shimmer/CPP) and rolls each sustained tone up into a Vocal Coherence Index. One Rust DSP core feeds two frontends:

- `crates/core` (`omalyzer-core`) — all DSP plus the `Analyzer` (FFT, hop/RMS-gate framing, sustained-tone capture state machine). Only non-std dependency is rustfft.
- `crates/desktop` (`omalyzer-live`) — macOS eframe/egui app; thin consumer of core (cpal mic input, spectrogram + readout UI).
- `crates/wasm` (`omalyzer-wasm`) — wasm-bindgen shim over `Analyzer`; owns no DSP. The browser's AudioWorklet pushes hops in; the render loop polls a flat `Snapshot`.
- `web/` — Vite + React + TS app at omalyzer.com. All analysis is client-side WASM. Four named worlds: landing "ONE BREATH" (`components/landing/HeroInstrument` — "Hold a tone" drives the real mic pipeline), `/science` "THE OBSERVATORY" (`components/science/` — four SVG ink set-pieces over a shared graticule + palette/motion utilities), `/analyze` "STILL ROOM / OPEN CONSOLE" (practice-first with console toggle, `ScoreReveal` braid ceremony on capture), dashboard "THE CONSTELLATION" (`components/signature/SignaturePlate` — the forming Vocal Resonance Signature). Shared braid kinematics live in `components/braid.ts`.
- `supabase/` — the only backend: auth + saved-om contributions (RLS Model B: users see only their own raw recordings, plus anonymized corpus aggregates).
- `web-proof/` — minimal M1 proof (mic → worklet → WASM); superseded by `web/`.
- `recordings/` — gitignored scratch space for audio files.

`docs/vocal-nervous-system-analysis.md` is the research grounding (the §5.2 coherence definitions and §3 feature toolbox the DSP implements) — read it before changing detection/coherence logic. `docs/web-community-roadmap.md` is the plan this monorepo executes; `DEPLOY.md` covers the omalyzer.com infrastructure.

## Commands

Rust (workspace root):

```sh
cargo run --release -p omalyzer-live   # desktop app (needs mic permission)
cargo test                             # DSP unit tests (core)
cargo test -p omalyzer-core pitch::    # tests for one module
cargo check                            # fast type-check
```

Web (from `web/`):

```sh
npm run wasm        # rebuild WASM (wasm-pack → web/src/wasm/pkg) — rerun after any core/wasm change
npm run dev         # Vite dev server (localhost:5173)
npm run build       # tsc -b && vite build
npm run typecheck
```

`./deploy.sh` (repo root) builds `web/`, syncs to S3, and invalidates CloudFront — see `DEPLOY.md`.

Supabase env: `web/.env.local` (gitignored) holds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. The public site and `/analyze` work without it; only sign-in and saving oms need it.

## Architecture

Dataflow per frame: audio source (cpal in desktop, AudioWorklet in web) → `Analyzer::push_samples` → 4096-sample hops over a 16384-sample FFT window → per-hop `AnalysisResult` behind an RMS silence gate with hysteresis + release hold → `coherence::SustainedSegment` accumulates each held tone, the capture ends when the tone does, and `compute` yields the Coherence Index (five 0..1 sub-metrics + weighted overall, per docs §5.2; thresholds are defaults, to be baseline-normalized per person later, §5.3).

Core DSP modules:

- `analyzer.rs` — owns the FFT, framing/gate, and the sustained-tone capture state machine; emits per-hop output from which frontends rebuild their spectrogram rings and plot histories. Both frontends drive this one type.
- `analysis.rs` — per-hop orchestrator combining the modules below into one `AnalysisResult`.
- `pitch.rs` — YIN F0 estimation, note naming, `PitchTracker` (jitter = short-term cents std-dev, drift = slow cents change of the held note).
- `formants.rs` — LPC formant estimation (decimate → pre-emphasis → autocorrelation → Levinson-Durbin → envelope peak-pick), −3 dB bandwidths, vowel classification.
- `harmonics.rs` — harmonic peak extraction, spectral centroid, HNR (Praat normalized-autocorrelation method).
- `spectral.rs` — spectral entropy, flatness, flux, alpha ratio (eGeMAPS bands).
- `voice_quality.rs` — shimmer, CPP/CPPS (FFT-based cepstrum), H1–H2.
- `coherence.rs` — `SustainedSegment` + `compute` → the Vocal Coherence Index.

Design convention: the DSP modules are pure functions on slices — std-only, no audio-device, egui, or wasm dependency — so they stay unit-testable. Keep new DSP in that style: device I/O lives in `crates/desktop/src/audio.rs` and the web AudioWorklet; UI lives in `crates/desktop/src/ui.rs` (egui) and `web/src` (React).

The analysis spectrum is wider than the displayed spectrogram (harmonic/HNR analysis needs up to 20·F0 and a 0–5 kHz noise-floor median) — don't truncate it to the display range.

Web design system: the whole site is IBM Plex Mono; the ॐ glyph renders in Tiro Devanagari. Light = reading (prose pages, parchment), dark = measuring (/analyze, dashboard plate) — one page, one atmosphere, never scroll-driven shifts. No animation libraries (SVG + rAF + CSS only, no Math.random); every animation honors prefers-reduced-motion with a composed static frame and pauses off-screen. Copy is expansive and forward-looking — trajectory, never deficiency. Contact email is info@shushu.be.
