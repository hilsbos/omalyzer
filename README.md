# Omalyzer

**Real-time vocal analysis for macOS.**  
Capture your microphone, see a scrolling spectrogram, and get live measurements of pitch, harmonics, formants, voice quality, and a **Vocal Coherence Index** computed over each sustained tone.

---

## What it does

Hold a vowel — or chant, hum, or just speak — and Omalyzer shows you, per ~90 ms analysis frame:

| Display | What it shows |
|---|---|
| **Spectrogram** | Scrolling low-frequency power (~45 s history, 0 – 4 kHz) |
| **Pitch (F0)** | Fundamental frequency in Hz + musical note + cents offset |
| **Jitter / drift** | Short-term pitch instability and slow pitch change (cents) |
| **Harmonics** | Count of harmonics above noise floor + spectral centroid |
| **Formants F1/F2/F3** | Vocal-tract resonances in Hz (define the vowel) |
| **Vowel** | Classified vowel (a / e / i / o / u) + confidence % |
| **HNR** | Harmonics-to-noise ratio in dB (higher = clearer voice) |
| **Vocal Coherence Index** | Per-sustained-tone score 0–1 (steady & clear = high) |

All processing runs locally; no audio is uploaded.

---

## Quickstart

**Requirements:** macOS with a working microphone, Rust toolchain (`cargo`).

```sh
# Build and launch
cd live
cargo run --release
```

On first launch macOS will ask for microphone permission. Grant it, then speak or hum.

**Run the tests (no microphone needed):**

```sh
cd live
cargo test
```

---

## Repository layout

```
omalyzer/
├── README.md                 ← you are here
├── CLAUDE.md                 ← agent guidance (architecture summary, conventions)
├── docs/
│   ├── vocal-nervous-system-analysis.md       ← research grounding (read before changing detection logic)
│   ├── omalyzer-nervous-system-implementation-spec.md  ← feature spec for nervous-system metrics
│   ├── ui-overview.md                         ← end-user UI reference
│   └── iphone-app-options.md                  ← future platform notes
└── live/                     ← the Rust crate (omalyzer-live)
    ├── Cargo.toml
    └── src/
        ├── main.rs           ← app state, DSP constants, FFT pipeline, silence gate, UI entry
        ├── audio.rs          ← cpal input stream (mic capture, device enumeration)
        ├── analysis.rs       ← per-hop orchestrator (combines all DSP modules)
        ├── pitch.rs          ← YIN F0 estimation, note naming, PitchTracker
        ├── formants.rs       ← LPC formant estimation + vowel classification
        ├── harmonics.rs      ← harmonic peak extraction, spectral centroid, HNR
        ├── spectral.rs       ← spectral entropy, flatness, flux, alpha ratio
        ├── voice_quality.rs  ← shimmer, CPP, H1–H2
        ├── coherence.rs      ← SustainedSegment accumulator + Vocal Coherence Index
        ├── ui.rs             ← egui rendering (spectrogram, pitch plot, vowel chart)
        └── colormap.rs       ← magma-ish colormap for the spectrogram
```

---

## Architecture overview

### Dataflow (per analysis frame, ~90 ms at 48 kHz)

```
Microphone (cpal)
    │  raw samples (Vec<f32>, downmixed to mono)
    ▼
audio.rs  ──mpsc channel──►  App::ingest_audio   (main.rs)
                                    │
                            slice into 4096-sample hops
                                    │
                    ┌───────────────┴───────────────┐
                    │  16384-sample FFT window       │
                    │  (Hann-windowed, STFT)         │
                    └───────────────┬───────────────┘
                                    │  linear magnitude spectrum
                                    │  (analysis: 0–9 kHz, display: 0–4 kHz)
                                    │
                            RMS silence gate
                           (hysteresis + release hold)
                                    │  gate open
                                    ▼
                            analysis::run()
                           ┌────────────────────────────────────────┐
                           │  pitch::yin          → F0, confidence  │
                           │  pitch::PitchTracker → jitter, drift   │
                           │  harmonics::analyze  → count, centroid │
                           │  harmonics::hnr_db   → HNR             │
                           │  formants::estimate  → F1/F2/F3 + BW  │
                           │  formants::classify_vowel → vowel      │
                           │  spectral::*         → entropy, flux   │
                           │                        alpha ratio     │
                           └───────────────┬────────────────────────┘
                                           │  AnalysisResult
                                           ▼
                               update_sustained_capture()
                              ┌─────────────────────────────┐
                              │  held-note state machine    │
                              │  SustainedSegment::push_hop │
                              │  voice_quality::shimmer     │  (on note end)
                              │  voice_quality::cpps        │  (on note end)
                              │  coherence::compute()       │  → CoherenceMetrics
                              └─────────────────────────────┘
                                           │
                                           ▼
                                    ui.rs / egui
```

### Key DSP constants (`main.rs`)

| Constant | Value | Meaning |
|---|---|---|
| `FFT_SIZE` | 16 384 | Window length (~341 ms at 48 kHz; ~2.7–2.9 Hz/bin) |
| `HOP` | 4 096 | Hop size (~85 ms; ~11–12 frames/s) |
| `SPEC_COLS` | 512 | Spectrogram history columns (~45 s) |
| `STORE_MAX_HZ` | 4 000 Hz | Spectrogram display ceiling |
| `ANALYSIS_MAX_HZ` | 9 000 Hz | Analysis spectrum ceiling (harmonics + noise-floor need this wider range) |
| `SUSTAINED_MIN_SECS` | 2.5 s | Minimum held-note duration for a Coherence Index to be reported |

### Design rules for DSP modules

- `pitch`, `formants`, `harmonics`, `spectral`, `voice_quality`, and `coherence` are **pure functions on slices** — `std`-only, no `cpal` or `egui` dependency — so they stay fully unit-testable.  
- Only `audio.rs` touches `cpal`. Only `ui.rs` and `main.rs` touch `egui`.  
- The FFT analysis spectrum (`latest_lin`) is intentionally wider than the displayed spectrogram: harmonic analysis needs up to 20 × F0 and the HNR noise-floor median covers 0–5 kHz, so never truncate it to the display range.

---

## Module reference

### `audio.rs` — Microphone capture
Enumerates input devices and opens a `cpal` input stream. Downmixes multi-channel input to mono and sends `Vec<f32>` chunks over an `mpsc` channel. The rest of the app is entirely decoupled from `cpal`.

### `analysis.rs` — Per-hop orchestrator
Calls all DSP modules in sequence for each FFT hop and returns one `AnalysisResult`. Applies the silence gate; when the gate is closed an all-default result (all fields `None`/`0`) is returned but the `PitchTracker` still receives an unvoiced push so it can time out the current note.

### `pitch.rs` — Pitch detection
**YIN algorithm** (de Cheveigné & Kawahara 2002): squared-difference function → cumulative-mean-normalized difference (CMND) → absolute threshold 0.15 → descent to local minimum → reject if CMND > 0.2 → parabolic interpolation. Lag range covers 70–500 Hz.

`PitchTracker` maintains up to 60 s of per-hop history and exputes:
- **Jitter** — std-dev in cents over the last ~1 s of the current note.
- **Drift** — cents change from the onset median to the recent median (~2 s each).

### `formants.rs` — LPC formants
Pipeline: anti-alias FIR + decimate to ~12 kHz → pre-emphasis → Hamming window → autocorrelation → Gaussian lag-window (~60 Hz bandwidth) → Levinson-Durbin (order 14) → evaluate LPC envelope on a 512-point grid 0–5 kHz → peak-pick F1/F2/F3 with harmonic-distrust heuristic.

**Vowel classification** maps (F1, F2) to one of {a, e, i, o, u} by nearest-centroid distance to reference values in Hz, reporting a confidence in `0..=1`.

### `harmonics.rs` — Harmonic analysis
`analyze`: for each k=1..20, finds the strongest *local-maximum* peak within ±3 bins of the expected harmonic bin in the linear magnitude spectrum. Uses parabolic interpolation for sub-bin accuracy. Reports count (harmonics ≥ 10 dB above noise floor), per-harmonic dB amplitudes (first 12), and spectral centroid.

`hnr_db`: HNR via Praat's normalized-autocorrelation method — `r(τ)` evaluated at the pitch lag, parabolic-refined, then `10·log10(r/(1−r))`.

### `spectral.rs` — Spectral descriptors
All operate on the same linear magnitude spectrum column:
- **Spectral entropy** — normalized Shannon entropy of the power spectrum (0 = tonal, 1 = noisy).
- **Spectral flatness** — geometric/arithmetic mean ratio (Wiener entropy).
- **Spectral flux** — positive-part L2 change between consecutive frames, normalized by current energy.
- **Alpha ratio** — eGeMAPS spectral tilt: `10·log10(E_low / E_high)` over 50–1000 Hz vs. 1000–5000 Hz.

### `voice_quality.rs` — Perturbation measures
- **Shimmer** — mean relative cycle-to-cycle peak-amplitude variation (computed once per sustained segment over the held audio buffer).
- **CPPS** — smoothed cepstral peak prominence: per-frame log-power-cepstrum smoothed across time and quefrency; peak above a linear regression baseline (dB). Feeds the harmonic sub-metric of the Coherence Index.
- **H1–H2** — first-minus-second harmonic amplitude (spectral tilt indicator).

> `cpp`, `h1_h2_db`, and `spectral_flatness` are validated and tested but not yet wired into the readout (`#[allow(dead_code)]`).

### `coherence.rs` — Vocal Coherence Index
`SustainedSegment` accumulates one feature row per voiced hop (F0, RMS, HNR, entropy, flux, mean formant BW, vowel confidence, alpha ratio). When the note ends, shimmer and CPPS are added once via `set_shimmer` / `set_cpps`.

`compute` maps the segment statistics to five sub-metrics (each 0–1):

| Sub-metric | Formula (defaults — tunable, see §5.3 in `vocal-nervous-system-analysis.md`) |
|---|---|
| **pitch** | `exp(−σ_cents / 25)` where σ is F0 std-dev in cents |
| **amplitude** | `exp(−shimmer / 0.06)` or `exp(−RMS_CV / 0.15)` |
| **harmonic** | mean of available { clamp(HNR/20), 1−entropy, clamp(CPPS/15) } |
| **spectral** | `exp(−mean_flux / 0.3)` |
| **resonance** | `0.5·vowel_conf + 0.5·clamp(1 − mean_BW/400)` |

The overall `index` is the **weighted harmonic mean** (weights 0.25/0.15/0.30/0.15/0.15) so that one weak dimension penalises the whole rather than being averaged away.

### `ui.rs` — Rendering
Three egui panels: spectrogram (scrolling texture, harmonic tick + formant line overlays), pitch-track plot (60 s log-frequency with note gridlines), vowel chart (F2 × F1 trapezoid with live dot + fading trail).

### `colormap.rs` — Colormap
Piecewise-linear interpolation through five stops of a magma-ish ramp (black → purple → pink → orange → cream). Input `t ∈ [0, 1]`; output `[R, G, B]` as `u8`.

---

## Honest framing

The research basis is in [`docs/vocal-nervous-system-analysis.md`](docs/vocal-nervous-system-analysis.md). Key points:

- **The acoustic measurements are real.** Pitch, formants, HNR, shimmer, spectral entropy — these are standard, validated voice-science measures.
- **State interpretation requires a personal baseline.** No single absolute number reliably means "stressed" or "relaxed" across people. The Coherence Index uses sensible default thresholds; meaningful state inference requires calibrating to each person's own baseline (planned in §5.3 of the research doc).
- **No medical claims.** This is an acoustic measurement tool, not a diagnostic device. The UI does not claim to detect stress, disease, or "energy."

---

## Dependencies

| Crate | Use |
|---|---|
| [`cpal`](https://crates.io/crates/cpal) | Cross-platform audio capture |
| [`eframe` / `egui`](https://crates.io/crates/eframe) | Immediate-mode GUI |
| [`rustfft`](https://crates.io/crates/rustfft) | FFT (Cooley-Tukey, in-place) |

No audio analysis crates are used; all DSP is implemented from scratch in `live/src/`.

---

## License

See repository root for license information.
