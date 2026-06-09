// main.js — main thread orchestration.
// getUserMedia -> verify settings -> AudioContext (read sampleRate) ->
// AudioWorklet -> WASM core -> requestAnimationFrame paint.
//
// Field names below match the wasm `Snapshot` struct (crates/wasm/src/lib.rs):
//   voiced, f0, note, vowel, vowel_conf, hnr_db, rms_db,
//   live_coherence_index, last_coherence_index, last_coherence_secs,
//   last_coherence_vowel, pitch_coherence, amplitude_coherence,
//   harmonic_coherence, spectral_stability, resonance_match.

import init, { WasmAnalyzer } from './pkg/omalyzer_wasm.js';

const $ = (id) => document.getElementById(id);

let ctx, analyzer, running = false;

function paintSettings(track) {
  const s = track.getSettings();
  $('settings').textContent = JSON.stringify(
    {
      sampleRate: s.sampleRate,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      channelCount: s.channelCount,
      deviceId: s.deviceId,
    },
    null,
    2,
  );
  // Warn if the browser silently kept any processing on.
  const warnings = [];
  if (s.echoCancellation) warnings.push('echoCancellation is ON (not honored)');
  if (s.noiseSuppression) warnings.push('noiseSuppression is ON');
  if (s.autoGainControl) warnings.push('autoGainControl is ON (AGC will corrupt HNR/jitter)');
  return warnings;
}

async function start() {
  if (running) return;
  $('start').disabled = true;
  $('warn').textContent = '';

  // 1. Raw-as-possible mic. Plain booleans (NOT {exact:...}) so capture never
  //    fails on a device that can't satisfy the constraint.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (e) {
    $('warn').textContent = 'getUserMedia failed: ' + e;
    $('start').disabled = false;
    return;
  }

  const track = stream.getAudioTracks()[0];
  const settingWarnings = paintSettings(track);

  // 2. AudioContext — READ sampleRate at runtime, never hardcode.
  ctx = new AudioContext();
  await ctx.resume(); // iOS/gesture-gated; we're inside the Start click handler
  const sr = ctx.sampleRate;
  $('sr').textContent = sr + ' Hz';

  // Warn about a likely 16 kHz Bluetooth/HFP route (collapses the usable band).
  const warns = [...settingWarnings];
  if (sr <= 16000) {
    warns.push(
      `sampleRate ${sr} Hz looks like a 16 kHz Bluetooth route — ` +
      `use the built-in or a wired mic for valid formants/HNR.`,
    );
  }
  if (warns.length) $('warn').textContent = '⚠ ' + warns.join('  |  ');

  // 3. WASM core — instantiate with the ACTUAL sample rate.
  await init(); // loads ./pkg/omalyzer_wasm_bg.wasm
  analyzer = new WasmAnalyzer(sr);
  analyzer.set_gate_db(-45.0); // optional; matches core default

  // 4. Worklet — add module, wire mic -> worklet.
  await ctx.audioWorklet.addModule('./worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'hop-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0, // sink only; we don't play anything back
    channelCount: 1,
    channelCountMode: 'explicit',
  });

  // 5. Receive 4096-sample hops, push into the WASM core.
  node.port.onmessage = (ev) => {
    // ev.data is a transferred Float32Array of exactly HOP samples.
    analyzer.push_samples(ev.data);
  };

  src.connect(node);
  // No connection to ctx.destination: with numberOfOutputs:0 the node still
  // pulls input and fires process(). (If a browser ever needs a pull, connect
  // node to a zero-gain GainNode -> destination.)

  running = true;
  $('start').textContent = 'Running';
  requestAnimationFrame(paint);
}

// Format an Option<f32> -> string, 3 decimals (or em-dash on null).
const f3 = (v) => (v == null ? '—' : v.toFixed(3));

// 6. Paint readouts on each animation frame (decoupled from ~11.7 hops/s).
function paint() {
  if (!running) return;
  const s = analyzer.snapshot();
  if (s) {
    $('rms').textContent = s.rms_db == null ? '—' : s.rms_db.toFixed(1);
    $('voiced').textContent = s.voiced ? 'yes' : 'no';
    $('f0').textContent = s.f0 == null ? '—' : s.f0.toFixed(1) + ' Hz';
    $('note').textContent = s.note || '—';
    $('vowel').textContent = s.vowel
      ? `${s.vowel} (${s.vowel_conf.toFixed(2)})`
      : '—';
    $('hnr').textContent = s.hnr_db == null ? '—' : s.hnr_db.toFixed(1);

    $('liveCoh').textContent =
      s.live_coherence_index == null
        ? '— (hold a tone ≥2.5 s)'
        : s.live_coherence_index.toFixed(3);
    $('lastCoh').textContent = f3(s.last_coherence_index);
    $('lastSecs').textContent =
      s.last_coherence_secs > 0 ? s.last_coherence_secs.toFixed(2) + ' s' : '—';
    $('lastVowel').textContent = s.last_coherence_vowel || '—';
    $('subPA').textContent = `${f3(s.pitch_coherence)} / ${f3(s.amplitude_coherence)}`;
    $('subHS').textContent = `${f3(s.harmonic_coherence)} / ${f3(s.spectral_stability)}`;
    $('subR').textContent = f3(s.resonance_match);
  }
  requestAnimationFrame(paint);
}

$('start').addEventListener('click', start);

// Re-resume the context if the tab was backgrounded (some browsers suspend it).
document.addEventListener('visibilitychange', () => {
  if (running && document.visibilityState === 'visible' && ctx) ctx.resume();
});
