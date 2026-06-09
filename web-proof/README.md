# web-proof — browser WASM mic pipeline proof

Minimal vanilla-JS proof that the **unmodified** `omalyzer-core` DSP runs in a
browser: mic → AudioWorklet (128→4096 reblock) → `omalyzer-wasm` (`WasmAnalyzer`
shim over `core::Analyzer`) → live readouts.

All DSP/FFT/gating/coherence stays in `crates/core` and is bit-identical with
the desktop app. The shim (`crates/wasm`) only marshals the borrowed/`Option`/
`char` core API into a flat JS snapshot object.

## Build + run

```sh
# 1. Build the wasm into web-proof/pkg/ (requires wasm-pack)
#    which wasm-pack || brew install wasm-pack || cargo install wasm-pack
wasm-pack build crates/wasm --release --target web \
  --out-dir ../../web-proof/pkg

# 2. Serve over a secure context (http://localhost counts) and open
./web-proof/serve.sh          # -> http://localhost:8080/
# open http://localhost:8080/ in Chrome, click "Start microphone"
```

`web-proof/pkg/` is a build artifact and is gitignored.

## Files

- `index.html` — Start button + live readouts.
- `main.js`    — main thread: getUserMedia, AudioContext, worklet, wasm glue, rAF paint.
- `worklet.js` — AudioWorkletProcessor: 128→4096 reblock, posts whole hops (thin sink, no DSP).
- `serve.sh`   — `python3 -m http.server 8080`.
- `pkg/`       — wasm-pack output (gitignored): `omalyzer_wasm.js` + `omalyzer_wasm_bg.wasm`.

## Manual test checklist (needs a real browser + mic + user gesture)

This pipeline **cannot** be exercised headlessly. Verify in a real browser:

1. `./web-proof/serve.sh`, open <http://localhost:8080/> in Chrome.
2. Click **Start microphone**, grant permission. Button reads "Running".
3. **Applied track settings** shows `echoCancellation/noiseSuppression/
   autoGainControl: false` (warn banner appears if the browser kept any ON).
4. **Sample rate** shows the real device rate (e.g. 48000 Hz). A `<=16000` rate
   triggers the Bluetooth/HFP warning.
5. Sing/hum a steady vowel. **Voiced** flips to `yes`; **F0**, **Note**, and
   **Vowel** populate; **RMS** rises above the noise floor; **HNR** shows a value.
6. Hold one steady tone ≥ ~2.5 s. **Live index (held tone)** populates; on
   release, **Last completed index**, **duration**, **vowel**, and the five
   sub-metrics populate.
7. Stop phonating: **Voiced** returns to `no`, live readouts dash out.
8. Open DevTools console: no Rust panics (panic hook surfaces them as errors).
