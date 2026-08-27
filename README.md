# omalyzer

**Real-time vowel-chant analysis — in the browser at [omalyzer.com](https://omalyzer.com), and as a macOS desktop app.**  
Hold a tone and omalyzer extracts per-hop voice features (pitch, harmonics, formants, vowel, jitter/drift, HNR, shimmer/CPP) and rolls each sustained tone up into a **Vocal Coherence Index**. One Rust DSP core feeds both frontends; on the web it runs as WASM, entirely client-side — no audio leaves the device unless you choose to save an om.

---

## What it does

Hold a vowel — or chant, hum, or just speak — and omalyzer shows you, per ~85 ms analysis frame:

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

---

## Quickstart

**Desktop app** (macOS, Rust toolchain):

```sh
cargo run --release -p omalyzer-live   # asks for microphone permission on first launch
cargo test                             # DSP unit tests (no microphone needed)
```

**Web app** (from `web/`, needs Node + [wasm-pack](https://rustwasm.github.io/wasm-pack/)):

```sh
npm install
npm run wasm        # build the WASM core → web/src/wasm/pkg (rerun after any core/wasm change)
npm run dev         # Vite dev server at http://localhost:5173
```

The public site and `/analyze` work without any backend. Sign-in and saving oms need a
Supabase project: put `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `web/.env.local`
(gitignored) and apply `supabase/migrations/`. Deployment is described in [`DEPLOY.md`](DEPLOY.md).

---

## Repository layout

```
omalyzer/
├── README.md                 ← you are here
├── CLAUDE.md                 ← agent guidance (architecture summary, conventions)
├── DEPLOY.md / deploy.sh     ← omalyzer.com deploy
├── docs/
│   ├── vocal-nervous-system-analysis.md       ← research grounding (read before changing detection logic)
│   ├── omalyzer-nervous-system-implementation-spec.md  ← feature spec for nervous-system metrics
│   ├── web-community-roadmap.md               ← the plan this monorepo executes
│   ├── ui-overview.md                         ← desktop UI reference
│   └── iphone-app-options.md                  ← future platform notes
├── crates/
│   ├── core/       ← omalyzer-core: all DSP + the Analyzer (FFT, framing/gate, capture state machine)
│   │   └── src/
│   │       ├── analyzer.rs       ← owns the FFT, hop framing, silence gate, sustained-tone capture
│   │       ├── framing.rs        ← DSP constants (FFT_SIZE, HOP, gate thresholds, …)
│   │       ├── analysis.rs       ← per-hop orchestrator (combines all DSP modules)
│   │       ├── pitch.rs          ← YIN F0 estimation, note naming, PitchTracker
│   │       ├── formants.rs       ← LPC formant estimation + vowel classification
│   │       ├── harmonics.rs      ← harmonic peak extraction, spectral centroid, HNR
│   │       ├── spectral.rs       ← spectral entropy, flatness, flux, alpha ratio
│   │       ├── voice_quality.rs  ← shimmer, CPP, H1–H2
│   │       ├── coherence.rs      ← SustainedSegment accumulator + Vocal Coherence Index
│   │       └── colormap.rs       ← magma-ish colormap for the spectrogram
│   ├── desktop/    ← omalyzer-live: eframe/egui macOS app (audio.rs = cpal input, ui.rs = egui)
│   └── wasm/       ← omalyzer-wasm: wasm-bindgen shim over Analyzer (owns no DSP)
├── web/            ← Vite + React + TS app at omalyzer.com (all analysis client-side via WASM)
├── supabase/       ← the only backend: auth + saved-om contributions (schema + RLS)
└── web-proof/      ← minimal early mic → worklet → WASM proof; superseded by web/
```

---

## Architecture overview

### Dataflow (per analysis frame, ~85 ms at 48 kHz)

```
Audio source
  desktop: cpal input stream (audio.rs) ──mpsc──►
  web:     AudioWorklet ──postMessage──► wasm shim ──►
                                    │
                         Analyzer::push_samples   (crates/core/src/analyzer.rs)
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

### Key DSP constants (`crates/core/src/framing.rs`)

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
- `omalyzer-core` is std-only (its one non-std dependency is `rustfft`): no `cpal`, `egui`, or wasm-bindgen. Device I/O lives in `crates/desktop/src/audio.rs` and the web AudioWorklet; UI lives in `crates/desktop/src/ui.rs` (egui) and `web/src` (React).  
- The FFT analysis spectrum (`latest_lin`) is intentionally wider than the displayed spectrogram: harmonic analysis needs up to 20 × F0 and the HNR noise-floor median covers 0–5 kHz, so never truncate it to the display range.

---

## Module reference

### `analyzer.rs` — The engine both frontends drive
Owns the FFT, hop/RMS-gate framing, and the sustained-tone capture state machine. Frontends call `push_samples` and read per-hop output from which they rebuild their spectrogram rings and plot histories.

### `audio.rs` (desktop) — Microphone capture
Enumerates input devices and opens a `cpal` input stream. Downmixes multi-channel input to mono and sends `Vec<f32>` chunks over an `mpsc` channel. The rest of the app is entirely decoupled from `cpal`.

### `analysis.rs` — Per-hop orchestrator
Calls all DSP modules in sequence for each FFT hop and returns one `AnalysisResult`. Applies the silence gate; when the gate is closed an all-default result (all fields `None`/`0`) is returned but the `PitchTracker` still receives an unvoiced push so it can time out the current note.

### `pitch.rs` — Pitch detection
**YIN algorithm** (de Cheveigné & Kawahara 2002): squared-difference function → cumulative-mean-normalized difference (CMND) → absolute threshold 0.15 → descent to local minimum → reject if CMND > 0.2 → parabolic interpolation. Lag range covers 70–500 Hz.

`PitchTracker` maintains up to 60 s of per-hop history and computes:
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

### `ui.rs` (desktop) — Rendering
Three egui panels: spectrogram (scrolling texture, harmonic tick + formant line overlays), pitch-track plot (60 s log-frequency with note gridlines), vowel chart (F2 × F1 trapezoid with live dot + fading trail).

### `colormap.rs` — Colormap
Piecewise-linear interpolation through five stops of a magma-ish ramp (black → purple → pink → orange → cream). Input `t ∈ [0, 1]`; output `[R, G, B]` as `u8`.

---

## Research grounding

The research basis is in [`docs/vocal-nervous-system-analysis.md`](docs/vocal-nervous-system-analysis.md): the §3 feature toolbox the DSP implements and the §5.2 coherence definitions. The acoustic measurements — pitch, formants, HNR, shimmer, spectral entropy — are standard, validated voice-science measures. The Coherence Index ships with default thresholds; per-person baseline normalization (§5.3) is the planned next step, and the web dashboard is where that baseline forms over time.

---

## Dependencies

| Crate | Use |
|---|---|
| [`cpal`](https://crates.io/crates/cpal) | Cross-platform audio capture |
| [`eframe` / `egui`](https://crates.io/crates/eframe) | Immediate-mode GUI |
| [`rustfft`](https://crates.io/crates/rustfft) | FFT (Cooley-Tukey, in-place) — the core's only non-std dependency |
| [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) | Browser shim for the core |
| React + Vite + TypeScript, [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) | Web app |

No audio analysis crates are used; all DSP is implemented from scratch in `crates/core/src/`.

---

## License

See repository root for license information.
