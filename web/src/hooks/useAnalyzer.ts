import { useCallback, useEffect, useRef, useState } from 'react';
import init, { WasmAnalyzer } from '../wasm/pkg/omalyzer_wasm';
import type { Snapshot } from '../types/snapshot';

export interface AnalyzerStatus {
  running: boolean;
  sampleRate: number | null;
  /** Raw track.getSettings() from the live capture (for the fidelity export). */
  settings: MediaTrackSettings | null;
  warnings: string[];
  error: string | null;
}

/**
 * One completed "om": a single sustained tone the user held (>= 2.5 s),
 * captured the moment the core finalized its coherence. Audio, duration, and
 * coherence snapshot are all aligned to the same tone.
 */
export interface Om {
  /** Raw mono PCM of the held tone (the worklet's uncorrupted Float32 stream). */
  pcm: Float32Array;
  /** Tone duration in seconds (core's last_coherence_secs for this tone). */
  durationSecs: number;
  /** Capture sample rate (Hz) the PCM is at. */
  sampleRate: number;
  /** The completing snapshot — its last_coherence_* / detail_* describe THIS tone. */
  snapshot: Snapshot;
  /** Wall-clock ms (Date.now()) when captured. */
  capturedAt: number;
}

/** Rolling per-hop histories the canvases read (filled only on new hops). */
export interface AnalyzerHistory {
  /** Newest-last ring of display dB columns (Float32) for the spectrogram. */
  columns: Float32Array[];
  /** Newest-last [hop, f0Hz] for the pitch track (voiced only). */
  pitch: Array<[number, number]>;
  /** Newest-last [hop, f1, f2] for the vowel chart (voiced w/ formants only). */
  vowel: Array<[number, number, number]>;
}

const GATE_DB = -45.0; // matches core default / web-proof

// History caps. Spectrogram ~45 s, pitch/vowel 60 s — generous at ~12 hops/s.
const MAX_COLUMNS = 540;
const MAX_PITCH = 760;
const MAX_VOWEL = 760;

/**
 * Owns the full capture pipeline ported verbatim from web-proof/main.js, plus
 * React lifecycle/teardown. Refs hold the mutable audio graph (never
 * re-rendered); a single `snapshot` state + rAF loop drives the UI.
 */
export function useAnalyzer() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lastOm, setLastOm] = useState<Om | null>(null);
  const sampleRateRef = useRef<number>(48000);
  const [status, setStatus] = useState<AnalyzerStatus>({
    running: false,
    sampleRate: null,
    settings: null,
    warnings: [],
    error: null,
  });

  // Mutable audio graph — refs so re-renders don't recreate it.
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyzerRef = useRef<WasmAnalyzer | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // Per-hop histories (mutated in place; canvases read them each frame). Kept in
  // a ref so accumulation never triggers a React re-render — only the latest
  // `snapshot` state does, which is what drives the rAF-paced repaint.
  const historyRef = useRef<AnalyzerHistory>({ columns: [], pitch: [], vowel: [] });
  const lastHopRef = useRef<number>(-1);
  const gateRef = useRef<number>(GATE_DB);
  const [gateDb, setGateDbState] = useState<number>(GATE_DB);

  // Continuous rolling raw-PCM tap. While the analyzer runs, EVERY worklet hop
  // (the same Float32 the WASM core consumes) is COPIED into a bounded ring so
  // that, the instant the core reports a held tone completed, we can slice that
  // tone's audio out of recent history. Passive copy — never touches the
  // analyzer's stream, so analysis stays uncorrupted. ~30 s @ 48 kHz bounds memory.
  const rollingRef = useRef<{ chunks: Float32Array[]; length: number }>({
    chunks: [],
    length: 0,
  });
  const MAX_ROLLING_SAMPLES = 48000 * 30;

  // Edge-detection of the core's monotonic completion counter. -1 = uninitialized
  // (first snapshot seeds it without firing, so a tone completed before this hook
  // started polling can't spuriously capture).
  const lastSeqRef = useRef<number>(-1);

  /** Update the RMS silence-gate threshold (the one display control that feeds
   *  back into the DSP). Applies live if the analyzer is running. */
  const setGate = useCallback((db: number) => {
    gateRef.current = db;
    setGateDbState(db);
    analyzerRef.current?.set_gate_db(db);
  }, []);

  const resetHistory = () => {
    historyRef.current = { columns: [], pitch: [], vowel: [] };
    lastHopRef.current = -1;
    rollingRef.current = { chunks: [], length: 0 };
    lastSeqRef.current = -1;
  };

  // Append a snapshot to the histories, but only when a NEW hop has landed (the
  // rAF loop polls faster than ~12 hops/s, so most frames repeat a hop).
  const accumulate = (snap: Snapshot) => {
    if (snap.hop_index === lastHopRef.current) return;
    lastHopRef.current = snap.hop_index;
    const h = historyRef.current;

    if (snap.col_db && snap.col_db.length) {
      h.columns.push(Float32Array.from(snap.col_db));
      if (h.columns.length > MAX_COLUMNS) h.columns.shift();
    }
    if (snap.voiced && snap.f0 != null && snap.f0 > 0) {
      h.pitch.push([snap.hop_index, snap.f0]);
      if (h.pitch.length > MAX_PITCH) h.pitch.shift();
    }
    if (snap.voiced && snap.f1 != null && snap.f2 != null && snap.f1 > 0 && snap.f2 > 0) {
      h.vowel.push([snap.hop_index, snap.f1, snap.f2]);
      if (h.vowel.length > MAX_VOWEL) h.vowel.shift();
    }
  };

  // When the core's completion counter increments, a held tone (>= 2.5 s) just
  // finalized. Slice its audio out of the rolling tap by the tone's reported
  // duration and bundle it with the completing snapshot into `lastOm`.
  const captureCompletedOm = (snap: Snapshot) => {
    const seq = snap.coherence_seq;
    // Seed on first sight without firing (a pre-poll completion can't capture).
    if (lastSeqRef.current === -1) {
      lastSeqRef.current = seq;
      return;
    }
    if (seq === lastSeqRef.current) return;
    lastSeqRef.current = seq;

    const sr = sampleRateRef.current;
    const want = Math.max(1, Math.round(snap.last_coherence_secs * sr));

    // Flatten the rolling ring, then take the LAST `want` samples — that tail is
    // the held tone (plus the few release-hold hops the gate added; a small
    // trailing offset is acceptable per spec). Clamp to what's buffered.
    const roll = rollingRef.current;
    const total = roll.length;
    const take = Math.min(want, total);
    const pcm = new Float32Array(take);
    // Walk chunks from the end, filling pcm back-to-front.
    let need = take;
    let writeEnd = take;
    for (let i = roll.chunks.length - 1; i >= 0 && need > 0; i--) {
      const c = roll.chunks[i];
      const from = Math.max(0, c.length - need);
      const slice = c.subarray(from);
      writeEnd -= slice.length;
      pcm.set(slice, writeEnd);
      need -= slice.length;
    }

    setLastOm({
      pcm,
      durationSecs: snap.last_coherence_secs,
      sampleRate: sr,
      snapshot: snap,
      capturedAt: Date.now(),
    });
  };

  /** Read the rolling histories (read-only; do not mutate). */
  const getHistory = useCallback((): AnalyzerHistory => historyRef.current, []);

  // Teardown: cancel rAF, disconnect graph, stop tracks, close ctx, drop wasm.
  const stop = useCallback(() => {
    runningRef.current = false;
    rollingRef.current = { chunks: [], length: 0 };
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    srcRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();

    analyzerRef.current?.free(); // wasm-bindgen frees the Rust-side Analyzer
    analyzerRef.current = null;
    nodeRef.current = null;
    srcRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;

    setStatus((s) => ({ ...s, running: false }));
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    resetHistory();
    setStatus((s) => ({ ...s, error: null, warnings: [] }));

    // 1. Raw-as-possible mic — PLAIN booleans (not {exact:...}) so capture
    //    never fails on a device that can't satisfy the constraint.
    let stream: MediaStream;
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
      setStatus((s) => ({ ...s, error: `getUserMedia failed: ${e}` }));
      return;
    }
    streamRef.current = stream;

    // Readback: warn if the browser silently kept processing on.
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    const warnings: string[] = [];
    if (settings.echoCancellation) warnings.push('echoCancellation is ON (not honored)');
    if (settings.noiseSuppression) warnings.push('noiseSuppression is ON');
    if (settings.autoGainControl)
      warnings.push('autoGainControl is ON (corrupts HNR/jitter)');

    // 2. AudioContext — READ sampleRate at runtime, never hardcode.
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    await ctx.resume(); // gesture-gated; runs inside the user click handler
    const sr = ctx.sampleRate;
    sampleRateRef.current = sr;
    if (sr <= 16000) {
      warnings.push(
        `sampleRate ${sr} Hz looks like a 16 kHz Bluetooth route — ` +
          `use built-in/wired mic for valid formants/HNR.`,
      );
    }

    // 3. WASM core — instantiate with the ACTUAL sample rate.
    await init(); // explicit init gate (loads *_bg.wasm)
    const analyzer = new WasmAnalyzer(sr);
    analyzer.set_gate_db(gateRef.current);
    analyzerRef.current = analyzer;

    // 4. Worklet — DSP-FREE; just tiles 4096-sample hops. WASM stays main-thread.
    await ctx.audioWorklet.addModule(new URL('/worklet.js', import.meta.url).href);
    const src = ctx.createMediaStreamSource(stream);
    srcRef.current = src;
    const node = new AudioWorkletNode(ctx, 'hop-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0, // sink only
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    nodeRef.current = node;

    // 5. Each hop -> push into the WASM core (per 4096-sample boundary).
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const hop = ev.data;
      // Continuous rolling tap: copy the hop BEFORE handing it to WASM
      // (push_samples may neuter/consume the transferred buffer). Independent
      // memory; trim oldest chunks once the ring exceeds the cap.
      const roll = rollingRef.current;
      roll.chunks.push(Float32Array.from(hop));
      roll.length += hop.length;
      while (roll.length > MAX_ROLLING_SAMPLES && roll.chunks.length > 1) {
        roll.length -= roll.chunks[0].length;
        roll.chunks.shift();
      }
      analyzerRef.current?.push_samples(hop);
    };
    src.connect(node); // no connect to destination (numberOfOutputs:0 still pulls)

    // 6. rAF paint loop — poll snapshot() into React state (decoupled from hops).
    runningRef.current = true;
    const paint = () => {
      if (!runningRef.current || !analyzerRef.current) return;
      const snap = analyzerRef.current.snapshot() as Snapshot;
      accumulate(snap);
      captureCompletedOm(snap);
      setSnapshot(snap);
      rafRef.current = requestAnimationFrame(paint);
    };
    rafRef.current = requestAnimationFrame(paint);

    setStatus({ running: true, sampleRate: sr, settings, warnings, error: null });
  }, []);

  // Re-resume on tab refocus (some browsers suspend backgrounded contexts).
  useEffect(() => {
    const onVis = () => {
      if (runningRef.current && document.visibilityState === 'visible') {
        ctxRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Teardown on unmount.
  useEffect(() => () => stop(), [stop]);

  /** Read the current snapshot once, out of band of the rAF state loop. */
  const peek = useCallback((): Snapshot | null => {
    if (!analyzerRef.current) return null;
    return analyzerRef.current.snapshot() as Snapshot;
  }, []);

  /** Drop the last captured om (e.g. after the user saves or discards it). */
  const clearLastOm = useCallback(() => setLastOm(null), []);

  return {
    snapshot,
    status,
    start,
    stop,
    peek,
    getHistory,
    gateDb,
    setGate,
    lastOm,
    clearLastOm,
  };
}
