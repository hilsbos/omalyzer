# Bringing Omalyzer to iPhone — options & recommendation

> Decision-support document for adding an iOS app while keeping the richer macOS
> desktop app and sharing one pure-Rust DSP core. Written June 2026. Versions and
> dates are current as of then; re-verify the fast-moving ones (egui, Slint iOS,
> Dioxus native renderer, UniFFI/swift-bridge) before committing.

---

## 1. TL;DR

- **Recommended (primary): Shared `omalyzer-core` Cargo workspace + a native Swift/SwiftUI iOS app calling the Rust core over a thin FFI (UniFFI), with mic capture in Swift via AVAudioEngine.** Why: 100% of the DSP IP is reused unchanged, you get a first-class native iOS UX and the most proven App Store path, and you sidestep both cpal's youngest backend (iOS input) and egui's weakest area (text/native-feel).
- **Strong fallback (fastest to a running app): egui/eframe directly on iOS** as a second build target. Why: the *entire* app — DSP **and** the existing spectrogram/plot/vowel-chart UI — compiles for iOS almost verbatim; iOS safe-area is already upstream (egui **0.33.0**, so your pinned **0.33.3 already has it**), and cpal 0.18.1 actually does support iOS mic input. The cost is a non-native single-canvas UI with some App Store review judgment risk.
- **Do this first regardless of UI choice:** extract the std-only DSP modules into a platform-agnostic `core` crate and lift the rustfft forward-FFT + hop/window/gate framing out of `main.rs`. This is low-risk, benefits the desktop app today, and is a prerequisite for *every* option below.
- **Widest-reach alternative (no App Store at all): Web / WASM (PWA)** — compile the same DSP core to `wasm32-unknown-unknown`, capture mic via Web Audio (`getUserMedia` + AudioWorklet), and ship one *responsive* UI that runs in desktop **and** mobile browsers from a static HTTPS host. Niche: maximum reach, zero App-Store friction (no $99/yr, no review), one codebase, one URL. Trade-off: **mic-fidelity and perf caveats on mobile Safari** — iOS WebKit won't give you a truly raw mic stream (AGC is coupled to `echoCancellation`, residual high-frequency conditioning), the AudioContext is foreground-only and gesture-gated, and you must hand-build a separate touch UI (no hover tooltips, no auto-reflow). Best as a complement to — not a replacement for — a native store app. See **§3.6**.
- **Avoid for now:** Dioxus mobile (native renderer still young/unstable; webview fallback negates its advantage) and Slint on iOS (still officially a tech-preview, no confirmed shipped App Store apps, and you'd rewrite all custom visuals). Both are credible in ~12 months, not today.
- **Honest caveat:** no option has a *confirmed, shipped, real-time iOS mic→Rust-analyzer→spectrogram* public example. The mic-capture + re-blocking-to-4096-hops work is greenfield in every path, so the audio glue (not the DSP) is the real long pole.

---

## 2. Current architecture & what is portable

Per `live/Cargo.toml` the crate has exactly three direct deps — `cpal = "0.18.1"`,
`eframe = "0.33.3"`, `rustfft = "6.4.1"` (edition 2024) — and the source confirms the
clean split CLAUDE.md describes.

**Pure, std-only DSP (ports to iOS unchanged — this is the bulk of the IP):**

| Module | Surface |
| --- | --- |
| `pitch.rs` | `yin`, `hz_to_note`, stateful `PitchTracker` (jitter/drift) |
| `formants.rs` | `Formants`, `estimate`, `classify_vowel` |
| `harmonics.rs` | `HarmonicInfo`, `analyze`, `hnr_db` |
| `spectral.rs` | `spectral_entropy`, `spectral_flatness`, `spectral_flux` |
| `voice_quality.rs` | `shimmer`, `cpp`, `h1_h2_db` |
| `coherence.rs` | `SustainedSegment`/`CoherenceMetrics`, `compute` (five 0..1 sub-metrics + weighted index) |
| `analysis.rs` | `AnalysisResult`, `run(...)` orchestrator (FFT magnitudes passed **in**) |
| `colormap.rs` | pure display helper |

**Platform-bound (rewritten per platform):**

- `audio.rs` — cpal input stream → mpsc. On iOS: AVAudioEngine tap (Swift) **or** cpal's iOS RemoteIO backend.
- `main.rs` + `ui.rs` — eframe/egui shell, scrolling spectrogram, pitch-track plot, vowel chart, coherence panel, gate/dB sliders.

**One wrinkle to fix early:** the forward FFT (`rustfft` `FftPlanner`/`process`) and the
HOP=4096 / FFT_SIZE=16384 / RMS-gate framing currently live in `main.rs::ingest_audio`,
coupled to `App` state. They are pure CPU and shareable, but must be lifted into `core`
so iOS gets bit-identical magnitudes and the same gating. `analysis::run` already takes
magnitude spectra as input, so the boundary is clean once the FFT is moved.

### Proposed target layout

```
omalyzer/
├── Cargo.toml                # [workspace]
├── crates/
│   ├── core/                 # omalyzer-core: std-only DSP + rustfft FFT + hop/window/gate
│   │   └── src/ {pitch, formants, harmonics, spectral,
│   │             voice_quality, coherence, analysis, colormap,
│   │             fft, framing}.rs
│   ├── desktop/              # omalyzer-live: eframe/egui + cpal (today's app, depends on core)
│   │   └── src/ {main, ui, audio}.rs
│   └── ffi/                  # omalyzer-ffi (RECOMMENDED option): UniFFI surface over core
│       └── src/lib.rs        #   crate-type = ["staticlib","cdylib","lib"]
└── ios/                      # Xcode SwiftUI app: AVAudioEngine + Metal/Canvas, links the XCFramework
```

The desktop app keeps cpal/eframe/rustfft and changes only its imports. `cargo test
pitch::` and friends keep running natively on the Mac with no device/simulator.

---

## 3. The options

### 3.1 egui/eframe directly on iOS (single Rust codebase) — *fallback / fastest*

**How it works.** eframe is a thin shell over egui-winit + a wgpu renderer. On iOS the
same desktop path applies: winit creates a Metal-backed surface, egui paints an
immediate-mode UI into one full-screen canvas, and winit maps touch/HiDPI/scale-factor
automatically. You build a staticlib/cdylib, link it into a thin Xcode target, and drive
it with `cargo-mobile2` (`cargo apple run`).

**Shared vs rewritten.** Maximal reuse: the entire DSP core, the rustfft FFT, the
hop/gate state machine, **and** `ui.rs`'s draw code (spectrogram texture, pitch plot,
vowel chart, coherence panel, sliders) all render on iOS with near-zero change. Only a
~50-line iOS bootstrap shim + Info.plist and the audio source are iOS-specific; layout
origins should move from `screen_rect` to `content_rect` for the notch/Dynamic Island.

**Mic capture.** Two real choices. (a) **cpal as-is** — contrary to a common belief,
cpal **0.18.1 supports `aarch64-apple-ios` mic input** (via RemoteIO; input shipped in
PR #485 back in 2021 with an `ios-feedback` example tested on-device), so `audio.rs` may
compile and run nearly unchanged. (b) AVAudioEngine via objc2 for `.measurement` mode.
Either way you still set `NSMicrophoneUsageDescription` + configure/activate
`AVAudioSession`; assume cpal does *not* set the session category for you.

**Maturity (verified).** eframe/egui latest **0.34.3 (2026-05-27)**; your pinned
**0.33.3 (2025-12-11)**. **Correction to common lore:** iOS safe-area landed in
**0.33.0 (2025-10-09)** (PR #7578, authored by @irh; `SafeArea`→`SafeAreaInsets`,
`viewport_rect` vs `content_rect`, `screen_rect` deprecated) — **not** 0.34.0. So
**0.33.3 already has iOS safe-area**; you do **not** need to bump to ≥0.34 for the notch
(a bump may be desirable for other fixes, but is not required, and would force
revalidating the desktop app against the deprecated-`screen_rect` API). winit is iOS
Tier-2 (Cargo.lock pins winit 0.30.13, wgpu 27.0.1); safe-area is **not** gated on winit
0.31 (which is still beta). `cargo-mobile2` **v0.22.4 (2026-04-29)** is actively
maintained and ships an egui template (currency of the template's eframe pin is
unconfirmed; the only public example, `lucasmerlin/egui-apple-example`, is stale at
eframe 0.28). The official iOS discussion #5434 remains unanswered — docs lag the code.

**Effort.** Medium, mostly the AVAudioEngine/cpal capture shim + Xcode/Info.plist
wiring + debugging winit-iOS lifecycle/launch-screen gotchas. The DSP and UI draw code
are effectively free. A few days to a first on-device build for someone comfortable with
Rust + a little objc2.

**App Store fit.** Plausible but not a slam-dunk. Apple allows self-rendered canvases
(games, creative tools ship routinely), and respecting safe-area + a real feature set +
a clear mic-usage string mitigates "not native enough" scrutiny. There is **no
authoritative Apple statement and no confirmed shipped App-Store egui app** — treat as a
real but manageable risk.

**Verdict for this app.** The fastest way to a working iPhone build and the only option
that reuses the existing visualizations verbatim — genuinely attractive because our UI
is touch/slider/plot based with essentially no text entry (egui's weakest area). Best
as a **time-boxed spike or a deliberate fallback**; the long-term cost is a non-native
look and self-managed Tier-2 iOS support.

### 3.2 Rust core + native SwiftUI, FFI via UniFFI — *recommended*

**How it works.** `core` holds the DSP; a thin `omalyzer-ffi` crate
(`crate-type=["staticlib","cdylib"]`) exposes a long-lived `Analyzer` object
(`#[uniffi::export]`) with `push_samples(Vec<f32>)` / `analyze() -> AnalysisResult`
(records become Swift structs). You cross-compile for `aarch64-apple-ios` +
`-sim`, package an XCFramework (cargo-swift or cargo-xcframework), and link it into a
SwiftUI app. Swift owns mic + UI; Rust owns all the math (FFT lifted into core for one
source of truth).

**Shared vs rewritten.** 100% of the DSP core is shared and moved into `core`, with the
desktop app as the second consumer. Rewritten in Swift: the UI (SwiftUI + Swift
Charts/Metal for the scrolling spectrogram, pitch-track, vowel chart, coherence panel,
gate/dB sliders) and audio capture. New Rust: the thin `ffi` shim — it re-exposes types,
re-declares none of the math.

**Mic capture.** Entirely in Swift. Configure `AVAudioSession` `.record`/`.playAndRecord`
with **mode `.measurement` to disable AGC/processing** (essential for clean
formant/HNR/jitter), `installTap(onBus:bufferSize:4096:...)` on `inputNode`, copy
`floatChannelData[0]` into a lock-free ring buffer on the audio thread, drain on a
non-audio thread into **exact 4096-sample hops** (iOS `bufferSize` is advisory — it
often forces ~1024–4800 frames, and Bluetooth routes like AirPods can drop to 24 kHz),
and call `analyzer.push_samples`.

**Maturity (verified).** UniFFI **0.31.1 (2026-04-13)**, Mozilla-maintained, used in
shipping Firefox iOS — production-grade; records/vectors cross via a `RustBuffer` copy
(negligible at ~11 hops/s if you push whole hops, never per-sample); Swift 6/Sendable
support is "partial" (mind actor isolation for the long-lived `Analyzer`). `cargo-swift`
**v0.11.1 (2026-05-20)** explicitly tracks UniFFI 0.31.1 — pin a matching version, it
does not auto-detect. `aarch64-apple-ios`/`-sim` are rustc Tier-2 (no nightly).
Alternative bridge **swift-bridge 0.1.59 (2026-01-06)** is pre-1.0 and still lacks
`&[f32]`/`&mut [f32]` slice support ("Not yet implemented"), forcing raw-pointer
plumbing — hence UniFFI is recommended for this struct-heavy API.

**Effort.** Medium, but front-loaded on UI. Workspace refactor + lift FFT ~1–2 days;
UniFFI shim ~1–2 days; XCFramework/CI wiring ~1–2 days; AVAudioEngine + ring-buffer
re-blocking + session edge cases ~2–4 days; the **SwiftUI spectrogram/charts is the
bulk** (~1–2+ weeks for parity, the Metal/Canvas scrolling spectrogram especially). DSP
is essentially free.

**App Store fit.** High / no known blocker. Linking a Rust staticlib (AOT, no JIT, no
private APIs) is exactly how Firefox iOS, Signal, 1Password ship. Requirements that
matter: `NSMicrophoneUsageDescription`, AOT-only code, correct signing, arm64 device +
sim slices. (Note: a commonly cited "Rust+" App Store app is the *game* Rust's
companion, not evidence of the *language* — rely on the Mozilla/Glean precedent
instead.)

**Verdict for this app.** **Best long-term home.** Native UX, AVFoundation/haptics/
accessibility, the most proven store path, and the math stays a single Rust source of
truth shared with desktop (and an Android port later is nearly free via UniFFI). The
price is a second UI codebase and owning the AVAudioSession real-time correctness — both
acceptable for a serious app.

### 3.3 Slint (one `.slint` UI for desktop + iOS) — *not yet*

**How it works.** Declarative `.slint` markup compiled to Rust you drive via generated
property setters/callbacks; renderers are Skia, FemtoVG, and a software renderer.
The DSP core ports unchanged; the win would be one UI for both targets.

**Shared vs rewritten.** DSP shared. But Slint has **no chart/canvas/plot widget**, so
all four custom visuals (the ~580 lines of egui painter code: spectrogram, pitch track,
vowel chart, coherence bars) must be rebuilt — the spectrogram as a per-frame
`SharedPixelBuffer`→`Image` (a clean 1:1 with today's `ColorImage`/`TextureHandle`
pattern), the rest as pixel buffers or hand-assembled `Path`/`Rectangle`/`Text`. The
immediate-mode→retained/declarative shift is real ceremony for an every-frame visualizer,
and `Image` is `!Send` (background thread + `invoke_from_event_loop`).

**Mic capture.** Orthogonal — same AVAudioEngine/objc2 shim (or cpal iOS) as any option;
`NSMicrophoneUsageDescription` + session config required.

**Maturity (verified).** Slint overall is mature (**1.16.1, 2026-04-23**, ~22.8k stars,
needs Rust 1.88+). **iOS is officially a tech-preview** (introduced 1.12, Jun 2025;
safe-area/virtual-keyboard in 1.15; pinch/rotate gestures in 1.16) and is **not listed
as a supported platform in the README**; an NLnet-funded "Slint on iOS" project targets
full support by **2026-08-01 (not yet met)**. No confirmed shipped iOS App Store app.
The GPU/Metal path (`to_wgpu_28_texture`/`FemtoVGWGPURenderer`) is feature-flagged and
"may change across minor releases." Licensing: triple-license (GPL **OR** Royalty-free-2.0
**OR** paid); the royalty-free tier permits proprietary mobile apps with an AboutSlint
attribution, **but excludes "Embedded Systems" and primary sources do NOT explicitly
confirm a phone isn't one** — get written confirmation from Slint before shipping closed-
source.

**Effort.** Medium-to-high, front-loaded on rewriting all four visuals (~1–3 weeks).

**App Store fit.** Licensing-viable (with the Embedded-Systems clause confirmed) and
Slint documents Xcode signing/TestFlight/App Store flows, but the technical risk is the
tech-preview status — you'd be an early adopter on iOS.

**Verdict for this app.** Compelling *one-UI* promise, but today it means rewriting every
visual onto an unproven-on-iOS, tech-preview target with an unresolved license question.
Revisit after iOS goes first-class (targeting late 2026).

### 3.4 Dioxus 0.7 mobile / Tauri v2 mobile — *Tauri OK-ish, Dioxus not yet*

**How it works.** Both are Rust-first: `core` is just a workspace dep. **Tauri v2**
renders a JS/WebGL `<canvas>` spectrogram in a WKWebView and streams FFT columns from
Rust over a `tauri::ipc::Channel`. **Dioxus 0.7** writes the UI in Rust (RSX); mobile
defaults to a WebView (same WKWebView reality, but you never write JS) with an
experimental native WGPU/Vello renderer.

**Shared vs rewritten.** DSP shared in both. Tauri: build a JS/HTML/WebGL front-end +
the Channel glue. Dioxus: rewrite views in RSX and draw the spectrogram via canvas/WGPU.

**Mic capture.** Neither ships a real-time PCM mic tap. Tauri: write a Swift `Plugin`
subclass around AVAudioEngine (existing audio plugins are record-to-file or playback
only — `tauri-plugin-mic-recorder` writes WAV, `tauri-plugin-native-audio` is playback).
Dioxus: call AVAudioEngine from Rust via **objc2-avf-audio 0.3.2** — the
`installTapOnBus_bufferSize_format_block` binding *exists* but is `unsafe` and takes an
objc2 `AVAudioNodeTapBlock` (wrap a closure in `RcBlock`), so lower-level than
"ergonomic."

**Maturity (verified).** **Tauri v2.11.2 (2026-05-16)** — stable, mobile production-ready,
mature `tauri ios` tooling and Xcode project generation. **Dioxus 0.7.9 (2026-05-08)**
(0.8.0-alpha started 2026-05-19); iOS setup is documented as challenging (no Xcode
project generated by default; use `dx bundle`, manual provisioning), and the native WGPU
renderer that would give the best custom-canvas story is **young/unstable** (open issue
#3725, in-progress PR #3979) — the safe path is the webview canvas, which negates
Dioxus's main advantage.

**Effort.** ~1.5–2.5 weeks either way, dominated by audio glue + UI recreation. Tauri is
lower-risk (mature mobile tooling); Dioxus risks time lost to immature iOS tooling.

**App Store fit.** Both ship real iOS apps; the native mic+DSP feature set argues against
a "minimum-functionality webview wrapper" (4.2) rejection. Tauri is the more proven path.

**Verdict for this app.** **Tauri** is a viable middle path *if* you actively want a
web/canvas UI, but it puts your real-time spectrogram behind a WKWebView IPC boundary
(fine at ~11 columns/s, friction if you ever want denser updates) and re-introduces a
JS/HTML codebase — strictly worse than native SwiftUI for *this* app. **Dioxus** is not
recommended yet: to draw a good custom spectrogram you'd lean on its unstable native
renderer, and its iOS tooling is the least mature here.

### 3.5 Flutter (flutter_rust_bridge) / React Native (uniffi-rn) — *Flutter capable, not preferred*

**How it works.** Compile `core` to a static lib, bind to Dart or JS/TS.
**Flutter + FRB** generates Dart bindings; the spectrogram is a `CustomPainter`; results
stream back over `StreamSink` (zero-copy typed arrays for PCM/spectra). **RN + uniffi-rn**
generates a Turbo Module; visuals via react-native-skia.

**Shared vs rewritten.** DSP shared. UI fully rewritten (Dart CustomPainter / RN Skia).
Audio captured on the Dart/JS side and forwarded into Rust.

**Mic capture.** Flutter: `record` package (AVFoundation, `startStream` with
`pcm16bits`), `mic_stream`, or `flutter_voice_processor` → convert to f32 mono → Rust.
RN: a native audio Turbo module. `NSMicrophoneUsageDescription` + `.measurement` session
in both; FRB zero-copy makes the ~11 hops/s transfer cheap.

**Maturity (verified).** **flutter_rust_bridge 2.12.0 (2026-03-29)**, Flutter-Favorite,
first-class `StreamSink` + zero-copy arrays — genuinely real-time-friendly, and the same
Dart UI could target Android free. **uniffi-bindgen-react-native 0.31.0-2 (early Jun
2026)** is pre-1.0, has **no streaming primitive and cannot pass a Promise/Future as an
argument** — so the continuous result stream must be faked via polling/callbacks, awkward
at ~11 Hz. Flutter + embedded Rust staticlib ships on the App Store routinely (now needs
a `PrivacyInfo.xcprivacy` manifest); RN+Rust store viability is inferred, not separately
confirmed.

**Effort.** Flutter ~1–2 weeks (the CustomPainter spectrogram is the bulk; must batch via
`drawRawAtlas`/`drawVertices`/texture upload to hold 60fps — naive `drawRect` loops are a
documented CPU hog). RN comparable-to-greater with more risk.

**App Store fit.** Good for Flutter. No blocker for RN, but it's the weaker fit for a
high-rate streaming visualizer.

**Verdict for this app.** Flutter is technically capable and the best non-native option
if Android parity matters soon — but it adds a whole Dart/Flutter toolchain + language on
top of Rust for no UX advantage over native SwiftUI. React Native is the weakest fit here
(missing stream primitive). Choose Flutter only if cross-platform mobile (incl. Android)
is a near-term goal.

### 3.6 Web / WASM (PWA) — runs on desktop + mobile, no App Store — *widest reach, mobile-Safari caveats*

**How it works.** Compile the same `core` to `wasm32-unknown-unknown`, capture the mic
with the Web Audio API, and render a responsive UI in any browser — desktop **and**
mobile — served as static files over HTTPS. No store, no review, no $99/yr; updates ship
by pushing to the host, and users can "Add to Home Screen" for an app-like PWA shell. Two
UI sub-strategies exist:

- **(a) eframe on the web target** — the *same* egui draw code as option 3.1, compiled to
  WASM and painted into one `<canvas>` via WebGL2 (glow) or WebGPU (wgpu). All of
  `ui.rs`'s painter code (spectrogram texture, pitch plot, vowel chart, coherence bars,
  sliders) ports nearly verbatim. **Recommended render backend: glow/WebGL2**, not wgpu —
  wgpu drags in Naga (WGSL→GLSL), inflating the `.wasm`; WebGPU is now default-on in
  Safari 26 / iOS 26 but has reported device-lost issues on Safari 26 in some WASM
  toolchains, so WebGL2 is the conservative, widest-reach default for a 2-D app.
- **(b) a DOM/HTML+CSS shell + plain 2-D Canvas** that calls the WASM DSP core directly
  (no egui). More work, but you get real CSS reflow, real ARIA/accessibility, browser
  font/zoom integration, and tap-friendly native controls — exactly the things egui's
  canvas cannot provide on mobile.

For *this* app, **(b) is the better long-term web UI** and **(a) is the fastest spike**;
see **§3.7** for the responsive-UI recommendation.

**Shared vs rewritten.** The whole DSP pipeline is shared verbatim — *measured*: all eight
pure modules plus rustfft compile to wasm32 with **zero source changes** (see §3.8). Only
the platform layers are replaced: `audio.rs` (cpal) → `getUserMedia` + AudioWorklet, and
`main.rs`/`ui.rs` → either eframe-web (sub-strategy a, near-verbatim) or a DOM+Canvas
front-end (sub-strategy b, a UI rewrite). The FFT/hop/gate framing should be lifted into
`core` (Phase A) so the WASM build gets bit-identical magnitudes, same as every other
option.

**Mic capture in the browser.** This is the load-bearing part and where mobile Safari
degrades things honestly:

- **Disable browser DSP** via `getUserMedia({audio:{ echoCancellation:false,
  noiseSuppression:false, autoGainControl:false }})` (plain booleans, not `{exact:…}`, so
  capture never fails), then **verify with `track.getSettings()`** and surface the actual
  values in the UI. On Chrome/Edge/Firefox desktop and Android Chrome these are honored
  well.
- **iOS WebKit does NOT independently honor `autoGainControl:false`** — the constraint was
  never implemented (WebKit #204444, still open). The only working lever is
  **`echoCancellation:false`, which on WebKit *also* disables AGC** (WebKit #179411,
  fixed 2019). So on iOS you must pass `echoCancellation:false` to get near-raw audio;
  relying on `autoGainControl:false` alone is unreliable. Pass all three constraints
  anyway (harmless), but on iOS treat `echoCancellation:false` as the real switch.
- **Residual conditioning on iOS.** Even with processing nominally off, older WebKit
  reports describe residual filtering that flat-lines content **above ~9–12 kHz**. That is
  *above* Omalyzer's 0–5 kHz formant/HNR band, so the practical impact on this app is
  smaller than it first looks — but it is unverified on current iOS 26 and **must be
  measured on-device** before trusting iOS spectra; the more relevant in-band unknowns are
  AGC gain dynamics and the user-toggled OS **Voice Isolation** mic mode (which is *not*
  controllable from any web constraint — you can only detect anomalies and tell the user
  to set Mic Mode to "Standard" in Control Center).
- **AudioWorklet, not ScriptProcessorNode.** The worklet (shipped Safari 14.1 / iOS 14.5)
  delivers fixed **128-frame render quanta**; accumulate into a ring/FIFO and emit a hop
  once **4096** samples are available (4096 = 32 × 128, a clean multiple, no fractional
  remainder). Never allocate or run the FFT inside `process()` — the worklet stays a thin
  copy/enqueue sink; run rustfft + features off the audio thread (main thread or a Web
  Worker). *(Web Audio 1.1 adds an optional `renderSizeHint` for a non-128 quantum, but
  it's ignored on Safari — the 32×128 re-blocking is the safe default path.)*
- **Do NOT hardcode the sample rate.** iOS commonly runs the AudioContext at 44100 (and a
  Bluetooth/AirPods HFP route silently drops it to **16000**, collapsing the usable band);
  forcing 48000 causes resampling glitches. Create `new AudioContext()`, read
  `ctx.sampleRate` at runtime, and thread it into the core — which already parameterizes
  `sr` everywhere (`bin_hz = sr/16384`, YIN, HNR all take `sr`). Detect a 16 kHz route and
  warn the user to use the built-in/wired mic.
- **Transport into WASM.** `postMessage(Float32Array)` per hop is entirely adequate at
  this app's ~11.7 hops/s; a **SharedArrayBuffer + Atomics ring buffer** is an optional
  zero-copy upgrade, not a requirement. SAB needs **cross-origin isolation** (COOP:
  `same-origin` + COEP: `require-corp`/`credentialless`), supported on iOS Safari 15.2+; if
  your host can't set those headers (e.g. plain GitHub Pages), fall back to `postMessage`
  with no penalty. If you do use SAB with a worklet, pass it via the
  `AudioWorkletNode` **`processorOptions`**, not `postMessage` (the latter historically
  copied rather than shared on WebKit).

**iOS-Safari & mobile specifics — does it work WELL? (honest).** **Desktop browsers:
yes**, essentially native-equivalent. **Mobile/iOS Safari: acceptable-but-degraded**, and
the degradations are real, not cosmetic:

- **Foreground-only.** iOS suspends the AudioContext on backgrounding/lock and has *no*
  background audio for the web. This is strictly a foreground tool — gate mic start behind
  an explicit "Start" tap and re-resume on `visibilitychange`.
- **Mic fidelity** is the genuine risk for a voice analyzer (see above): near-raw via
  `echoCancellation:false`, but AGC dynamics, Voice Isolation, and possible band-limiting
  are not fully defeatable and need on-device verification.
- **No hover.** `ui.rs` leans on `.on_hover_text()` pervasively (the coherence sub-metrics
  and the index explanation); hover does not exist on touch, so that information is
  invisible on a phone and must be redesigned to tap/expand or always-on captions.
- **Touch ergonomics.** egui's four sliders + the device combo are mouse-sized; enlarge
  touch targets and set CSS `touch-action:none` on the canvas so it doesn't fight page
  scroll/pinch.
- **Text entry is the one bug this app dodges entirely** — egui's iOS on-screen-keyboard
  failure (issue #4500, still open) is moot because the app has **zero** `TextEdit`
  widgets (verified: only 4 sliders + 1 combo box). That single fact is why the port is
  viable on iPhone at all.

**Maturity (verified).** eframe/egui web is a first-class, long-shipping WASM target
(latest **0.34.3, 2026-05-27**; your pin **0.33.3**, so a 0.33→0.34 minor bump — note
0.34 deprecated `App::update`→`App::ui` and unified `SidePanel`/`TopBottomPanel`, which
could touch layout code). WASM **fixed-width SIMD** (used by rustfft's opt-in `wasm_simd`
feature) is supported on Safari/iOS **16.4+** — set that as the floor, and JS-side
feature-detect SIMD (`wasm-feature-detect`) to load a scalar fallback rather than hard
trapping below it. The toolchain (`rustup target add wasm32-unknown-unknown`, Trunk /
`wasm-bindgen-cli`, `wasm-opt`) is standard and well-documented.

**Effort.** **Sub-strategy (a) eframe-web:** low — days to a desktop-browser build reusing
all the draw code; the spend is the Web Audio capture shim + a mobile layout branch +
replacing hover affordances. **Sub-strategy (b) DOM+Canvas:** medium — a genuine UI
rewrite (HTML/CSS/Canvas) on top of the WASM core, but you get a real responsive/accessible
mobile UI. The DSP is free in both.

**Distribution.** Any static HTTPS host (Cloudflare Pages, Netlify, GitHub Pages + a
header shim, an S3 bucket). No App Store account, no $99/yr, no review queue, no binary
signing; updates are a file push. Add a `manifest.json` for "Add to Home Screen" (Safari
26+ treats added sites as web apps); don't rely on an install prompt on iOS (manual Share
→ Add to Home Screen), on true fullscreen (status bar stays), or on persistent cache
(~7-day eviction if unused — fine, this app needs no offline storage).

**Verdict for this app.** **The best zero-friction reach play, and a strong companion to
the native SwiftUI app — not a substitute for it.** Compute is a non-issue (measured ~0.7
ms/hop, §3.8), the DSP ports with zero changes, and desktop browsers are excellent. The
honest ceiling is **mobile Safari**: foreground-only, un-pristine mic, no hover, and a
hand-built touch UI. For users who want "open a URL and chant," ship the web build; for
the polished, store-distributed, measurement-trustworthy mobile experience, the native
path (3.2) still wins. Doing **both** is realistic because they share the same `core`.

### 3.7 The responsive / mobile UI (a different UI from desktop)

The user explicitly needs a *different* UI on phones than on desktop. egui has **no
automatic responsive layout** — there are no CSS breakpoints; you branch manually on
`ui.available_width()`. So whichever sub-strategy you pick, the phone layout is
hand-written, not free.

**Recommendation:** for the *shared, broad-reach* mobile UI, prefer the **DOM/HTML+CSS +
2-D Canvas** approach (§3.6b). CSS Grid/Flexbox reflow is declarative and robust, you get
real touch controls, ARIA (the coherence hover descriptions map straight to ARIA labels),
browser zoom, and the smallest bundle (no wgpu). Keep **eframe-web (§3.6a) as an optional
desktop "expert" view** or as the fast initial spike. Rendering the scrolling spectrogram
to a plain Canvas (`putImageData` of one new column per hop, scroll the bitmap) is cheap
and avoids WebGPU entirely.

**Concrete responsive layout:**

*Phone portrait (single column, progressive disclosure):*

1. **Hero:** big Start/Stop button + the live *primary* readout only — vowel + F0/note +
   one overall **Coherence index** number/bar. This is the at-a-glance "how am I doing"
   line.
2. **Spectrogram** as the main visual, full-width, formant/harmonic overlays kept; clamp
   the displayed range to the live Nyquist (important when a Bluetooth route drops to
   16 kHz), and offer pinch-to-zoom the frequency axis *in place of* the desktop max-freq
   slider.
3. **One** secondary panel at a time behind a segmented/tab control: **Pitch track** ·
   **Vowel chart** · **Coherence detail** — never all three stacked.
4. **Coherence panel simplified:** show only the overall index bar; tap-to-expand reveals
   the five sub-metrics (pitch / amplitude / harmonic / spectral / resonance). Replace
   every `.on_hover_text()` with a tap/long-press info row or always-visible compact
   captions.
5. **Sliders collapsed** (max-freq, db-floor, db-ceil, gate) into an "Advanced" sheet/
   accordion with sensible mobile defaults, so most users never open it.

*Desktop (the existing dense view):* the **same component set** re-laid via a wider CSS
Grid — top readout row, coherence panel, large spectrogram center, pitch-track + vowel
chart side-by-side, sliders inline. One component set, two grid templates via media
queries.

*Touch targets & breakpoints:* every interactive control **≥44×44 CSS px** (Apple HIG) /
48 dp (Material), **≥8 px** apart; WCAG 2.5.8 floor is 24 px. Use **mobile-first,
content-driven breakpoints in `rem`** set where Omalyzer's panels actually stop fitting,
not at arbitrary device widths — typical bands: ≤480 phone portrait, 481–768 landscape/
small tablet, 769–1024 tablet, 1025+ desktop. Size the Canvas backing store to
`devicePixelRatio` for crisp retina rendering and redraw on orientation change. Set the
viewport meta (`width=device-width, initial-scale=1`).

### 3.8 Simulation results (measured locally)

These numbers were measured on this repo on an Apple-Silicon dev machine; framed honestly,
they de-risk the *compute and bundle* questions but **not** the mobile-Safari audio-fidelity
questions, which still require on-device testing.

- **DSP core → WASM: compiles with zero source changes.** All eight pure modules (pitch,
  formants, harmonics, spectral, voice_quality, coherence, analysis, colormap) built for
  `wasm32-unknown-unknown` as-is — they are genuinely std-only.
- **`.wasm` size — DSP core:** **~85 KiB** default release (reachable via exports),
  **~57 KiB** with rustc-only size flags (`opt-level="z"`, LTO). `wasm-opt -Oz` was not
  available locally and would typically shave further; gzip/brotli over the wire reduces
  all figures.
- **`.wasm` size — rustfft 6.4.1:** compiles to wasm32 cleanly (all transitive deps, no
  feature flags), **~272 KiB** default release (size-optimizable, upper bound). **Combined
  footprint ≈ 330 KiB pre-`wasm-opt`/pre-gzip** — well within web/mobile budgets.
- **Per-hop compute (native, full pipeline:** FFT + YIN + harmonics + HNR + LPC formants +
  vowel + entropy/flux + coherence push, always-voiced worst case): **~0.7 ms mean**
  (p95 ~0.7–0.8 ms) against the **85.3 ms** real-time budget — **~120× headroom** native.
- **Under a conservative 2× WASM-vs-native penalty:** ~1.4 ms/hop, still **~61× inside
  budget**. Even adding a 5–10× slower mobile CPU on top (10–20× total) leaves ~6–12×
  headroom. **Compute is not the bottleneck on mobile — the audio plumbing and mic
  fidelity are.**
- **Caveat:** these probes prove *compilation, size, and native compute* only; the WASM was
  not executed/validated for numerical parity, and `wasm_simd` was not benchmarked. The
  ~1.3–2× WASM penalty is a literature figure, not measured here.

### 3.9 Will the web version work properly? — honest verdict

"Will it work" splits into two questions with different answers: **will it run**, and
**will it be trustworthy**. For a measurement instrument those are not the same thing.

**Will it run? — yes, with confidence.**

- *Compute* is settled, not guessed: ~0.7 ms/hop measured against an 85 ms budget (~120×
  headroom; still ~6–12× after a 2× WASM penalty **and** a 5–10× slower mobile CPU).
  Real-time is a non-issue.
- *The port* is settled: the DSP compiled to WASM with zero source changes, ~330 KB total.
- *Desktop browsers* (Chrome/Edge/Firefox) honor the mic constraints, eframe-web is mature
  — on desktop this behaves essentially like the native app.

**Will it be trustworthy on iPhone? — genuinely unknown, and it's the part that matters
most.** This app's entire value is *measurement* (formants, HNR, jitter, coherence), and
those features are precisely the ones corrupted by automatic gain control and band-limiting.
On iOS WebKit you cannot fully guarantee a raw mic stream: the dedicated `autoGainControl:
false` is unimplemented (#204444), AGC is only defeatable as a side effect of
`echoCancellation:false`, and **Voice Isolation** mic mode isn't web-controllable at all.
So the realistic failure mode is not a crash — it's the worst case for an instrument:
**it runs perfectly while quietly reporting subtly wrong or unstable numbers on the one
platform you care most about.** The simulations could prove compute and size; they
**cannot** prove mic fidelity — that is only answerable on a physical device.

A partial mitigant: Omalyzer's own framing is *within-person deviation, not absolute
values*. A **consistent** iOS coloration would still allow useful relative tracking — but
AGC is *dynamic*, not a fixed offset, so this should not be leaned on heavily for
HNR/jitter.

**Verdict.**

- **Desktop web app — yes, it will work properly.**
- **Mobile-Safari web app — it will *run* properly, but its *trustworthiness as a measure*
  is a real, unresolved unknown** until tested on a real iPhone.

**The cheap way to settle it (do this before building the web UI):** a ~1-hour spike —
capture the mic in Safari on a physical iPhone with `echoCancellation:false`, push it
through the already-WASM-ready DSP core, and compare HNR / formants / coherence on a
sustained vowel against the desktop native app on the *same* voice. If the numbers track,
green-light the web/mobile path. If they wander, the iPhone wants the native AVAudioEngine
`.measurement` path (§3.2) *before* any web-UI investment. This single test converts the
one real uncertainty from opinion into data. (See §7 item 9.)

---

## 4. Comparison table

Ratings: ✅ strong / ⚠️ caveat / ❌ weak.

| Option | Code reuse | Native iOS UX | Effort | App Store fit | Real-time audio | Tooling maturity | Maintenance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **egui-on-iOS** | ✅ DSP **+ UI** reused | ❌ non-native single canvas | ✅ Low–Med (fastest) | ⚠️ allowed, review judgment | ✅ direct, no IPC | ⚠️ Tier-2, docs lag code | ✅ one codebase |
| **Rust core + SwiftUI (UniFFI)** | ✅ DSP reused | ✅ fully native | ⚠️ Med (UI rewrite) | ✅ proven (Firefox/Signal) | ✅ in-process FFI | ✅ UniFFI/iOS targets mature | ⚠️ 2 UIs |
| **Slint** | ✅ DSP; ❌ visuals rewritten | ⚠️ declarative, decent | ⚠️ Med–High | ⚠️ license + tech-preview | ⚠️ CPU pixel-buf OK at 11fps | ❌ iOS tech-preview | ✅ one UI (if it ships) |
| **Tauri v2** | ✅ DSP; ❌ JS UI | ⚠️ webview, not native | ⚠️ Med | ✅ proven | ⚠️ WKWebView IPC boundary | ✅ mature mobile | ⚠️ +JS/HTML |
| **Dioxus 0.7** | ✅ DSP; ❌ RSX UI | ⚠️ webview (native unstable) | ⚠️ Med (tooling risk) | ⚠️ fewer data points | ⚠️ webview or unstable WGPU | ❌ iOS tooling young | ✅ one UI |
| **Flutter (FRB)** | ✅ DSP; ❌ Dart UI | ⚠️ native-ish, not Apple | ⚠️ Med | ✅ proven | ✅ StreamSink + zero-copy | ✅ FRB mature | ⚠️ +Dart |
| **React Native (uniffi-rn)** | ✅ DSP; ❌ JS UI | ⚠️ native-ish | ❌ Med–High | ⚠️ inferred | ❌ no stream primitive | ⚠️ pre-1.0 | ⚠️ +JS/TS |
| **Web / WASM (PWA)** | ✅ DSP reused (zero changes) | ⚠️ browser UI, responsive | ✅ Low (eframe) – Med (DOM) | ✅ no store/review (N/A) | ⚠️ mobile-Safari mic/AGC caveats | ✅ eframe-web mature; WebAudio caveats | ✅ one responsive codebase |

**Reach (platforms).** A separate axis the table above doesn't capture: **Web / WASM is
the only option that reaches desktop browsers *and* Android *and* iOS from one build and
one URL** (egui-on-iOS and SwiftUI are iPhone-only; Flutter/RN add Android but not the
desktop web). If breadth of reach with zero install friction is the goal, the web option
is unique; if measurement-grade mobile capture and a polished store presence are the goal,
native SwiftUI (3.2) leads.

---

## 5. Recommended path, step by step

### Phase A — split into a workspace + shared core (low-risk, do anytime)

This benefits the desktop app immediately and is a prerequisite for every option.

1. **Create the workspace.** Add a top-level `[workspace]` `Cargo.toml`; create
   `crates/core` (`omalyzer-core`, std-only — no cpal/eframe/egui).
2. **Move the DSP modules** `pitch, formants, harmonics, spectral, voice_quality,
   coherence, analysis, colormap` into `core`. Fix imports.
3. **Lift the FFT + framing** out of `main.rs::ingest_audio` into `core` (e.g.
   `fft.rs` wrapping rustfft, `framing.rs` for HOP=4096 / FFT_SIZE=16384 window
   maintenance + the RMS gate with hysteresis + release hold). Expose an `Analyzer`/
   `push_hop(&[f32]) -> AnalysisResult` (or `push_samples` that re-blocks internally).
   Keep `analysis::run` taking magnitudes in.
4. **Repoint the desktop crate** (`crates/desktop`) at `core`; keep cpal/eframe/rustfft.
   Confirm `cargo run --release` and `cargo test pitch::` etc. still pass with no
   behavior change. **Ship this** — it's pure refactor value.

### Phase B — stand up the iPhone app (recommended: native SwiftUI + UniFFI)

5. **Add `crates/ffi`** (`omalyzer-ffi`, `crate-type=["staticlib","cdylib","lib"]`).
   `#[uniffi::export]` the `Analyzer` object; `#[derive(uniffi::Record)]` on
   `AnalysisResult`/`CoherenceMetrics`. Expose `push_samples(Vec<f32>)`, `analyze()`,
   and a spectrogram-column accessor. **Pin UniFFI 0.31.x and a matching cargo-swift
   (0.11.1).**
6. **Install iOS targets:** `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
   Build an XCFramework + Swift bindings with `cargo-swift` (or `cargo xcframework`); add
   to CI on a macOS runner.
7. **Create the Xcode SwiftUI app**, add the XCFramework/Swift package.
8. **Info.plist & signing:** add **`NSMicrophoneUsageDescription`** (clear human reason —
   missing string = ITMS-90683 rejection **and** a runtime crash on first mic access),
   add the `PrivacyInfo.xcprivacy` manifest, set up an Apple Developer account
   ($99/yr) + provisioning. Request mic permission **at point-of-use**, not at launch.
9. **Audio capture (Swift):** configure `AVAudioSession` `.record` + **mode
   `.measurement`** (disables AGC — critical for formant/HNR/jitter), start
   `AVAudioEngine`, `installTap(bufferSize:4096)` on `inputNode`. In the tap (real-time
   thread) copy `floatChannelData[0]` into a lock-free ring buffer; on a worker thread
   drain into **exact 4096-sample hops** and call `analyzer.push_samples`. Handle route
   changes/interruptions and verify sample rate (48 kHz typical; resample or flag if a
   Bluetooth route drops to 16/24 kHz).
10. **UI (SwiftUI/Metal):** scrolling low-freq spectrogram as a Metal texture (or
    `Canvas` if fast enough at scroll rate), pitch-track + vowel chart via Swift Charts,
    coherence panel, and gate/dB sliders mapped to core params. Marshal results to the
    main actor.
11. **Validate on a physical device:** confirm `.measurement` actually disabled
    processing, and that formant/HNR/jitter/coherence values match the desktop app on the
    same input. Then TestFlight.
12. **Keep desktop egui as the second consumer of `core`** so both targets share one DSP
    source of truth.

**If you want a quick win first:** before Phase B, time-box a 1–2 day **egui-on-iOS
spike** (option 3.1) using `cargo-mobile2` + cpal's iOS input to get *some* iPhone build
running on hardware and de-risk the audio path. If a non-native UI turns out acceptable
for your users, that spike can become the shipped app instead of the SwiftUI rewrite.

---

## 6. Effort & risk summary

| Phase | Effort | Risk |
| --- | --- | --- |
| A: workspace + core extraction + lift FFT/framing | ~1–2 days | Low — mechanical; modules already pure. Risk is the `main.rs` orchestration detangling, not the DSP. |
| B (SwiftUI/UniFFI): FFI shim | ~1–2 days | Low — well-trodden UniFFI pattern. |
| B: XCFramework + CI | ~1–2 days | Low–Med — fiddly toolchain/signing, macOS-only builds. |
| B: AVAudioEngine capture + re-blocking | ~2–4 days | **Med — the real long pole.** Advisory buffer sizes, AGC/`.measurement`, route changes, ring-buffer real-time safety. |
| B: SwiftUI spectrogram + charts | ~1–2+ weeks | Med — bulk of the work; Metal spectrogram perf to validate. |

The DSP is essentially free in every option. The spend is **UI recreation + audio-session
robustness**. egui-on-iOS collapses the UI cost to near-zero at the price of native feel
and store-review certainty.

---

## 7. Open questions / prototype first to de-risk

1. **End-to-end mic→hop→analyzer on a real iPhone.** No option has a confirmed public
   real-time iOS mic→Rust-analyzer→spectrogram example. Prototype the AVAudioEngine tap +
   ring-buffer re-blocking to exact 4096-sample hops **before** committing to the full UI.
2. **`.measurement` mode actually disables processing** (AGC/EQ) on target devices —
   verify formant/HNR/jitter parity against desktop on identical input. This is
   correctness-critical for a voice analyzer.
3. **Sample-rate variability.** DSP constants assume 44.1/48 kHz. Decide policy for
   Bluetooth routes (AirPods ~24 kHz, others lower) — resample, or detect-and-warn, since
   low rates degrade formant/HNR quality and change hops/sec.
4. **Metal/Canvas spectrogram frame cost** for the 16384-window/4096-hop pipeline at
   ~11 columns/s is unmeasured on-device in *every* option (egui/wgpu, SwiftUI Metal,
   Flutter CustomPainter, Slint pixel-buffer). Quick on-device profile.
5. **UniFFI RustBuffer copy at hop cadence** — almost certainly negligible if you push
   whole hops; confirm you never call per-sample, and check Swift 6 Sendable/actor
   isolation for the long-lived `Analyzer`.
6. **(If egui-on-iOS)** whether `cargo-mobile2`'s egui template scaffolds a current
   eframe and whether the repo's full dep set (wgpu 27, winit 0.30.13, cpal 0.18.1,
   edition 2024) cross-compiles cleanly for `aarch64-apple-ios` — not yet built/proven.
7. **(If egui-on-iOS)** App Store review of a single-canvas non-native UI — unproven; no
   authoritative Apple statement and no confirmed shipped egui App-Store app.
8. **(If Slint)** get **written confirmation from Slint** that an iOS App Store app is not
   barred by the royalty-free license's "Embedded Systems" exclusion.
9. **(If Web/WASM) The make-or-break iPhone mic-fidelity test — do this first.** A ~1-hour
   spike: capture the mic in Safari on a *physical* iPhone with `echoCancellation:false`,
   push it through the already-WASM-ready DSP core, and compare HNR / formants / coherence
   on a sustained vowel against the desktop native app on the *same* voice. Tracks → the
   web/mobile path is trustworthy; wanders → the iPhone needs the native AVAudioEngine
   `.measurement` path (§3.2) before any web-UI work. This is the single highest-value
   de-risking step for the web option (see §3.9).

---

## 8. Sources

- egui/eframe CHANGELOGs & PR #7578 (iOS safe-area, 0.33.0):
  https://raw.githubusercontent.com/emilk/egui/master/CHANGELOG.md ·
  https://raw.githubusercontent.com/emilk/egui/master/crates/eframe/CHANGELOG.md ·
  https://raw.githubusercontent.com/emilk/egui/master/crates/egui-winit/CHANGELOG.md ·
  https://github.com/emilk/egui/pull/7578 · https://github.com/emilk/egui/discussions/5434 ·
  https://docs.rs/eframe/latest/eframe/ · https://lib.rs/crates/eframe
- cpal (iOS input, AVAudioSession, maintenance):
  https://docs.rs/cpal/latest/cpal/ · https://crates.io/crates/cpal ·
  https://github.com/RustAudio/cpal/pull/485 · https://github.com/RustAudio/cpal/issues/842 ·
  https://github.com/RustAudio/cpal/issues/981 ·
  https://raw.githubusercontent.com/RustAudio/cpal/master/CHANGELOG.md
- winit / wgpu (iOS Tier-2, safe_area, 0.31 beta):
  https://rust-windowing.github.io/winit/winit/index.html ·
  https://github.com/rust-windowing/winit/releases/tag/v0.31.0-beta.1
- cargo-mobile2 / cargo-swift / xcframework:
  https://github.com/tauri-apps/cargo-mobile2 · https://crates.io/crates/cargo-mobile2 ·
  https://github.com/antoniusnaumann/cargo-swift/releases · https://crates.io/crates/xcframework ·
  https://github.com/tauri-apps/cargo-mobile2/issues/456 · https://crates.io/crates/cargo-xcode
- UniFFI / swift-bridge (Rust↔Swift):
  https://github.com/mozilla/uniffi-rs · https://crates.io/api/v1/crates/uniffi ·
  https://mozilla.github.io/uniffi-rs/latest/swift/overview.html ·
  https://mozilla.github.io/uniffi-rs/latest/swift/xcode.html ·
  https://github.com/chinedufn/swift-bridge · https://chinedufn.github.io/swift-bridge/built-in/index.html ·
  https://crates.io/api/v1/crates/swift-bridge ·
  https://blog.mozilla.org/data/2022/01/31/this-week-in-glean-building-and-deploying-a-rust-library-on-ios/ ·
  https://mozilla.github.io/firefox-browser-architecture/experiments/2017-09-06-rust-on-ios.html ·
  https://dev.to/almaju/building-an-ios-app-with-rust-using-uniffi-200a
- Rust iOS targets: https://doc.rust-lang.org/rustc/platform-support.html ·
  https://doc.rust-lang.org/beta/rustc/platform-support/apple-ios.html ·
  https://dev-doc.rust-lang.org/nightly/rustc/platform-support/aarch64-apple-ios-sim.html
- Slint: https://github.com/slint-ui/slint · https://crates.io/api/v1/crates/slint ·
  https://slint.dev/blog/slint-1.12-released · https://slint.dev/blog/slint-1.15-released ·
  https://slint.dev/blog/slint-1.16-released · https://slint.dev/pricing ·
  https://github.com/slint-ui/slint/blob/master/LICENSES/LicenseRef-Slint-Royalty-free-2.0.md ·
  https://github.com/slint-ui/slint/blob/master/FAQ.md · https://nlnet.nl/project/SlintiOS/ ·
  https://docs.rs/slint/latest/slint/struct.SharedPixelBuffer.html ·
  https://docs.rs/slint/latest/slint/struct.Image.html
- Dioxus / Tauri:
  https://github.com/DioxusLabs/dioxus/releases · https://dioxuslabs.com/learn/0.7/guides/platforms/mobile/ ·
  https://github.com/DioxusLabs/dioxus/issues/3725 · https://github.com/DioxusLabs/dioxus/pull/3979 ·
  https://github.com/DioxusLabs/dioxus/discussions/3545 ·
  https://github.com/tauri-apps/tauri/releases · https://v2.tauri.app/blog/tauri-20/ ·
  https://v2.tauri.app/develop/calling-rust/ · https://v2.tauri.app/develop/plugins/develop-mobile/ ·
  https://v2.tauri.app/concept/inter-process-communication/ ·
  https://github.com/ayangweb/tauri-plugin-mic-recorder · https://github.com/uvarov-frontend/tauri-plugin-native-audio ·
  https://docs.rs/objc2-avf-audio · https://docs.rs/objc2-avf-audio/latest/objc2_avf_audio/struct.AVAudioNode.html
- Flutter / React Native:
  https://github.com/fzyzcjy/flutter_rust_bridge · https://docs.rs/crate/flutter_rust_bridge/latest ·
  https://pub.dev/packages/flutter_rust_bridge ·
  https://cjycode.com/flutter_rust_bridge/manual/integrate/library/platform-setup/ios-and-macos ·
  https://pub.dev/packages/record · https://docs.flutter.dev/cookbook/audio/record ·
  https://github.com/flutter/flutter/issues/61721 · https://www.dowski.com/flutter-rust-ios/ ·
  https://github.com/jhugman/uniffi-bindgen-react-native ·
  https://jhugman.github.io/uniffi-bindgen-react-native/idioms/promises.html ·
  https://hacks.mozilla.org/2024/12/introducing-uniffi-for-react-native-rust-powered-turbo-modules/ ·
  https://www.npmjs.com/package/uniffi-bindgen-react-native
- Apple mic permission / privacy:
  https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSMicrophoneUsageDescription ·
  https://developer.apple.com/documentation/avfaudio/avaudiosession/requestrecordpermission(_:) ·
  https://developer.apple.com/documentation/AVFAudio/AVAudioSession ·
  https://developer.apple.com/documentation/avfaudio/avaudionode/installtap(onbus:buffersize:format:block:)
- Web / WASM — eframe-web, render backends, mobile egui:
  https://github.com/emilk/egui · https://docs.rs/crate/eframe/latest ·
  https://github.com/emilk/egui/issues/4500 · https://github.com/emilk/egui/issues/4569 ·
  https://github.com/emilk/egui/issues/279 · https://web.dev/blog/webgpu-supported-major-browsers ·
  https://webkit.org/blog/17640/webkit-features-for-safari-26-2/ · https://github.com/ocornut/imgui/issues/9103
- Web Audio mic capture / constraints / AudioWorklet / SAB-COOP-COEP:
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet ·
  https://developer.chrome.com/blog/audio-worklet-design-pattern/ ·
  https://web.dev/patterns/media/microphone-process · https://blog.addpipe.com/getusermedia-audio-constraints/ ·
  https://bugs.webkit.org/show_bug.cgi?id=179411 · https://bugs.webkit.org/show_bug.cgi?id=204444 ·
  https://bugs.webkit.org/show_bug.cgi?id=204467 · https://bugs.webkit.org/show_bug.cgi?id=237144 ·
  https://github.com/WebKit/standards-positions/issues/314 · https://support.apple.com/en-us/101993 ·
  https://www.w3.org/TR/webaudio-1.1/ · https://github.com/chrisguttandin/standardized-audio-context/issues/489 ·
  https://github.com/godotengine/godot/issues/36643 · https://caniuse.com/sharedarraybuffer ·
  https://web.dev/articles/coop-coep · https://webrtchacks.com/guide-to-safari-webrtc/
- WASM perf, SIMD, PWA limits, responsive UI:
  https://arxiv.org/abs/1901.09056v3 · https://caniuse.com/wasm-simd ·
  https://docs.rs/rustfft/6.4.1/rustfft/ · https://github.com/GoogleChromeLabs/wasm-feature-detect ·
  https://9to5mac.com/2024/03/01/apple-home-screen-web-apps-ios-17-eu/ ·
  https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ ·
  https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design ·
  https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/
