/* ── morning/types — the shared TS contract for the Morning Sequence ─────────
   "Morning Sequence" is the one-tap guided full-vowel scan: you open omalyzer
   some morning, press one button, and it walks you through holding each vowel
   in turn — calm, low-friction, without thinking — so the whole vowel space is
   captured in a single sitting and rolled into the Vocal Resonance Signature.

   This module is the single source of truth for the feature's shapes: the
   ordered script-item, the per-vowel capture result, the phase enum, and the
   hook's returned state. NO JSX, NO logic, NO React — every other morning/*
   module imports from here so the page consumes exactly what the hook/step/
   summary expose. Pure frontend over existing analyzer output; the Rust core
   and WASM bindings are off-limits and untouched. */

import type { Snapshot } from '../types/snapshot';
import type { Om, AnalyzerStatus } from '../hooks/useAnalyzer';
import type { ScoreRevealMetrics } from '../components/ScoreReveal';

/** The canonical core vowel keys — exactly the single-char lowercase strings
 *  the Rust classifier emits and signatureMath.VOWELS buckets on. The persisted
 *  / counted vowel value MUST stay one of these (never an uppercase label, or
 *  it silently falls into the '—' UNCLASSIFIED strip). */
export type VowelKey = 'a' | 'e' | 'i' | 'o' | 'u';

/** One entry in the guided script. Display copy (label/glyph/hint/copy) is the
 *  on-screen cue only; `key` is the raw core char used for persistence and
 *  iteration. f1/f2 are the reference formants (mirror the Rust classifier /
 *  VowelChart TARGETS) for any per-step targeting visual. */
export interface VowelScriptItem {
  /** Raw core vowel char — the persistence/iteration key. */
  key: VowelKey;
  /** Phonetic cue shown big on screen, e.g. 'OO', 'OH', 'AH', 'EH', 'EE'. */
  label: string;
  /** The slashed glyph the rest of the app uses, e.g. '/u/'. */
  glyph: string;
  /** A short anchoring hint, e.g. 'as in food'. */
  hint: string;
  /** One expansive, forward-looking encouraging line. */
  copy: string;
  /** Reference first formant (Hz) for this vowel target. */
  f1: number;
  /** Reference second formant (Hz) for this vowel target. */
  f2: number;
}

/** One captured (or skipped) vowel in the scan. `promptKey` is the vowel we
 *  asked for (the flow slot); `detectedVowel` is what the core actually
 *  classified (last_coherence_vowel — may differ, may be null). Persistence
 *  uses `detectedVowel ?? promptKey`. A skipped vowel carries
 *  coherenceIndex=null, om=null, skipped=true and never plots a fake strike. */
export interface MorningResult {
  /** The vowel this slot prompted for (raw core char). */
  promptKey: VowelKey;
  /** What the core classified for the captured tone, or null if ambiguous /
   *  skipped. */
  detectedVowel: string | null;
  /** snapshot.last_coherence_index — the number of record (null = skipped /
   *  no qualifying hold). */
  coherenceIndex: number | null;
  /** snapshot.last_coherence_secs — held duration (0 for a skip). */
  durationSecs: number;
  /** The five sub-metrics from the completing snapshot (for the ScoreReveal). */
  subMetrics: ScoreRevealMetrics;
  /** Per-capture identity key (Om.capturedAt) — remount/idempotency key. */
  capturedAt: number;
  /** The full captured tone (PCM + completing snapshot) for the opt-in save;
   *  null for a skipped vowel. */
  om: Om | null;
  /** True when the user chose to skip rather than hold this vowel. */
  skipped: boolean;
}

/** The step machine's coarse phase. idle → scanning → revealing →
 *  (scanning | summary); error reachable from begin(); summary → scanning via
 *  restart(). */
export type MorningPhase = 'idle' | 'scanning' | 'revealing' | 'summary' | 'error';

/** Everything the hook exposes — the page, step, and summary consume exactly
 *  this surface. Snapshot is the live per-hop read (for SettlingLine /
 *  steadiness during a hold); the coherence NUMBER never appears live. */
export interface MorningState {
  /** Coarse phase of the scan. */
  phase: MorningPhase;
  /** 0..MORNING_TOTAL-1 — selects the current script item. */
  stepIndex: number;
  /** MORNING_TOTAL (5) — the count of vowels in the scan. */
  total: number;
  /** The script item for stepIndex, or null when not scanning. */
  current: VowelScriptItem | null;
  /** The captured-so-far results, in scan order. */
  results: readonly MorningResult[];
  /** Live per-hop snapshot (read every render; never gates a transition). */
  snapshot: Snapshot | null;
  /** Mic/analyzer status (running, warnings, error). */
  status: AnalyzerStatus;
  /** The result currently being revealed (drives the in-place ScoreReveal);
   *  null outside the 'revealing' phase. */
  revealResult: MorningResult | null;
  /** The only place start() is called — wire to the Begin button's gesture. */
  begin: () => Promise<void>;
  /** Called by the per-vowel ScoreReveal's onDone to advance the scan. */
  onRevealDone: () => void;
  /** User-initiated 'skip this vowel' — records a null result and advances. */
  skipCurrent: () => void;
  /** Restart a fresh scan from the summary (stop → reset → start). */
  restart: () => Promise<void>;
}
