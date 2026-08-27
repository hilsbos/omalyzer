/* ── morning/useMorningSequence — the step state machine (the brain) ────────
   Wraps ONE useAnalyzer and drives the five-vowel guided scan:

     • start()s the mic exactly ONCE, from the Begin user gesture, and runs it
       across all five vowels (NEVER restart per vowel — start() re-prompts the
       mic, rebuilds the AudioContext, reloads the worklet, and wipes history).
     • detects each completed capture by watching lastOm.capturedAt — the
       core finalises a hold only after >= 2.5 s above the gate, and useAnalyzer
       republishes each real completion as a fresh `lastOm` (with aligned PCM).
       This already-debounced, frame-drop-proof signal IS the advance heuristic;
       we never watch snapshot.voiced or roll our own coherence_seq detector.
     • buffers each result OUT of the single overwritten lastOm slot the instant
       capturedAt changes (then clearLastOm()), keyed to the PROMPTED vowel,
       reading last_coherence_vowel/index/secs + the five sub-metrics.
     • plays the per-vowel ScoreReveal in place (phase 'revealing'); its onDone
       advances the scan; after the fifth vowel it stops the mic and shows the
       summary.
     • supports a calm manual 'skip this vowel' (records a null-coherence result
       and advances) — there is NO punishing auto-timeout.

   ACCEPT-BY-DETECTION: any qualifying held tone on the current step advances;
   we record what the core classified but keep the prompt as the flow slot, so
   the scan always completes in exactly five steps and a half-asleep user is
   never told to redo. Holds NO save logic — saving lives in MorningSummary.

   Pure frontend over useAnalyzer; the Rust core / WASM bindings are untouched. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnalyzer } from '../hooks/useAnalyzer';
import { MORNING_SCRIPT, MORNING_TOTAL } from './vowelScript';
import type { MorningPhase, MorningResult, MorningState } from './types';

export function useMorningSequence(): MorningState {
  const { snapshot, status, start, stop, lastOm, clearLastOm } = useAnalyzer();

  const [phase, setPhase] = useState<MorningPhase>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [results, setResults] = useState<readonly MorningResult[]>([]);
  const [revealResult, setRevealResult] = useState<MorningResult | null>(null);

  // phaseRef mirrors `phase` for the capture effect (which must read the
  // current phase without re-subscribing on every phase change).
  const phaseRef = useRef<MorningPhase>('idle');
  phaseRef.current = phase;

  // The last lastOm.capturedAt we already consumed — keyed idempotency so the
  // record fires exactly once per capture and survives StrictMode double-mount
  // and unrelated re-renders (the LivePage autoSavedAtRef idiom). Set
  // synchronously inside the effect before any state update.
  const handledAtRef = useRef<number | null>(null);

  // stepIndex for the capture effect, read synchronously (the effect must slot
  // the result under the CURRENT prompt without re-subscribing per step).
  const stepIndexRef = useRef(0);
  stepIndexRef.current = stepIndex;

  const current = phase === 'scanning' || phase === 'revealing' ? MORNING_SCRIPT[stepIndex] : null;

  /* ── advance: shared by reveal-onDone and skip ──────────────────────────── */
  const advance = useCallback(() => {
    setRevealResult(null);
    setStepIndex((k) => {
      if (k < MORNING_TOTAL - 1) {
        setPhase('scanning');
        return k + 1;
      }
      setPhase('summary');
      stop(); // release the mic; snapshot/lastOm retain stale values, ignored
      return k;
    });
  }, [stop]);

  /* ── begin: the ONLY place start() is called (user gesture) ──────────────── */
  const begin = useCallback(async () => {
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return;
    setResults([]);
    setRevealResult(null);
    setStepIndex(0);
    handledAtRef.current = null;
    setPhase('scanning');
    await start(); // gesture-gated; idempotent if already running
    // start() reports a getUserMedia denial through status.error (it never
    // throws). status is React state, so the post-await closure read is stale —
    // the error→phase transition is owned by the reactive effect below instead.
  }, [start]);

  /* ── restart: fresh scan from the summary ────────────────────────────────── */
  const restart = useCallback(async () => {
    stop();
    setResults([]);
    setRevealResult(null);
    setStepIndex(0);
    handledAtRef.current = null;
    setPhase('scanning');
    await start(); // resetHistory + lastSeqRef=-1 happen inside start()
  }, [start, stop]);

  /* ── error: surface a getUserMedia denial reactively ─────────────────────
     status.error lands a render AFTER start()'s await resolves, so it can't be
     read synchronously in begin()/restart(). Watch it instead: any error while
     a scan is live drops to the calm retry card (Begin is idempotent). */
  useEffect(() => {
    if (status.error && phaseRef.current === 'scanning') setPhase('error');
  }, [status.error]);

  /* ── skip: the only non-capture advance ─────────────────────────────────── */
  const skipCurrent = useCallback(() => {
    if (phaseRef.current !== 'scanning') return;
    const k = stepIndexRef.current;
    const skipped: MorningResult = {
      promptKey: MORNING_SCRIPT[k].key,
      detectedVowel: null,
      coherenceIndex: null,
      durationSecs: 0,
      subMetrics: { pitch: null, amplitude: null, harmonic: null, spectral: null, resonance: null },
      capturedAt: Date.now(),
      om: null,
      skipped: true,
    };
    setResults((rs) => [...rs, skipped]);
    advance(); // same advance branch as onRevealDone, but no reveal
  }, [advance]);

  /* ── capture: a NEW lastOm.capturedAt while scanning ─────────────────────── */
  useEffect(() => {
    if (!lastOm) return;
    if (phaseRef.current !== 'scanning') return;
    if (handledAtRef.current === lastOm.capturedAt) return;
    handledAtRef.current = lastOm.capturedAt; // synchronous: fire exactly once

    const snap = lastOm.snapshot;
    const k = stepIndexRef.current;
    const result: MorningResult = {
      promptKey: MORNING_SCRIPT[k].key,
      detectedVowel: snap.last_coherence_vowel,
      coherenceIndex: snap.last_coherence_index,
      durationSecs: snap.last_coherence_secs,
      subMetrics: {
        pitch: snap.pitch_coherence,
        amplitude: snap.amplitude_coherence,
        harmonic: snap.harmonic_coherence,
        spectral: snap.spectral_stability,
        resonance: snap.resonance_match,
      },
      capturedAt: lastOm.capturedAt,
      om: lastOm,
      skipped: false,
    };
    setResults((rs) => [...rs, result]);
    setRevealResult(result);
    clearLastOm(); // make intent explicit; next capture is unambiguously new
    setPhase('revealing');
  }, [lastOm, clearLastOm]);

  /* ── onRevealDone: ScoreReveal beat finished (or fired immediately) ──────── */
  const onRevealDone = useCallback(() => {
    if (phaseRef.current !== 'revealing') return;
    advance();
  }, [advance]);

  /* ── teardown: stop the mic on unmount (also covered by useAnalyzer) ─────── */
  useEffect(() => () => stop(), [stop]);

  return {
    phase,
    stepIndex,
    total: MORNING_TOTAL,
    current,
    results,
    snapshot,
    status,
    revealResult,
    begin,
    onRevealDone,
    skipCurrent,
    restart,
  };
}
