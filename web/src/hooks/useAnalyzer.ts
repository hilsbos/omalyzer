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

  // Parallel raw-PCM tap for FLAC capture. While `recordingRef.active` is true,
  // every worklet hop (the same Float32 the WASM core consumes) is COPIED into
  // `chunks`. This is a passive copy — it never touches the analyzer's stream, so
  // analysis stays uncorrupted. Caps at a generous ~30 s @ 48 kHz to bound memory.
  const recordingRef = useRef<{ active: boolean; chunks: Float32Array[]; length: number }>(
    { active: false, chunks: [], length: 0 },
  );
  const MAX_RECORD_SAMPLES = 48000 * 30;

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

  /** Read the rolling histories (read-only; do not mutate). */
  const getHistory = useCallback((): AnalyzerHistory => historyRef.current, []);

  // Teardown: cancel rAF, disconnect graph, stop tracks, close ctx, drop wasm.
  const stop = useCallback(() => {
    runningRef.current = false;
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
      // Parallel record tap: copy the hop BEFORE handing it to WASM (push_samples
      // may neuter/consume the transferred buffer). The copy is independent memory.
      const rec = recordingRef.current;
      if (rec.active && rec.length < MAX_RECORD_SAMPLES) {
        rec.chunks.push(Float32Array.from(hop));
        rec.length += hop.length;
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

  /** Begin retaining a copy of every worklet hop for FLAC capture. */
  const startRecording = useCallback(() => {
    recordingRef.current = { active: true, chunks: [], length: 0 };
  }, []);

  /** Stop retaining hops and return the concatenated mono PCM for the window. */
  const stopRecording = useCallback((): Float32Array => {
    const rec = recordingRef.current;
    rec.active = false;
    const out = new Float32Array(rec.length);
    let off = 0;
    for (const c of rec.chunks) {
      out.set(c, off);
      off += c.length;
    }
    rec.chunks = [];
    rec.length = 0;
    return out;
  }, []);

  return {
    snapshot,
    status,
    start,
    stop,
    peek,
    getHistory,
    gateDb,
    setGate,
    startRecording,
    stopRecording,
  };
}
