/* ── morning/VowelStep — the per-vowel step view (scan + reveal) ────────────
   One vowel, one breath. The big phonetic cue (label + slashed glyph + hint +
   one encouraging line), a quiet breathing presence ring whose brightness reads
   the LIVE steadiness of the held tone, the converging SettlingLine ribbon, the
   3-state steadiness word, a 5-dot progress rail (completed dots carry the
   detected-vowel glyph), and a calm 'still listening' + 'skip this vowel'
   affordance that surfaces only after a short delay. During the 'revealing'
   phase the in-place compressed ScoreReveal plays as that vowel's reckoning —
   the coherence number resolves ONLY there, never live.

   BRAND LAWS: dark "measuring" atmosphere (plate tokens, never the science
   paper TOKEN.*); whole flow IBM Plex Mono; the Om glyph only via OmMark (Tiro
   Devanagari); no green/red, no live number, no disclaimers. The presence ring
   honors prefers-reduced-motion (a composed static frame at the current
   steadiness) and pauses off-screen — both via useRafLoop / the static effect,
   exactly the SettlingLine contract. No Math.random; deterministic math only.

   Pure frontend over existing analyzer output; the Rust core / WASM bindings
   are untouched. */

import { useEffect, useRef } from 'react';
import SettlingLine from '../components/SettlingLine';
import ScoreReveal from '../components/ScoreReveal';
import OmMark from '../components/OmMark';
import {
  steadinessReadings,
  blendReadings,
  steadinessWord,
  emaStep,
  STEADINESS_REST,
} from '../components/steadiness';
import { clamp01, usePrefersReducedMotion, useRafLoop } from '../components/science/motion';
import type { MorningResult, VowelScriptItem } from './types';
import type { Snapshot } from '../types/snapshot';
import styles from './VowelStep.module.css';

/* ════════════════════════════ props ════════════════════════════════════ */

export interface VowelStepProps {
  /** The current script item — the vowel being prompted. */
  item: VowelScriptItem;
  /** 0..total-1 — drives the progress rail's current marker. */
  stepIndex: number;
  /** MORNING_TOTAL (5) — the rail length. */
  total: number;
  /** The results so far, in scan order — completed dots read their glyph. */
  results: readonly MorningResult[];
  /** Live per-hop snapshot (presence ring + SettlingLine + word); never gates. */
  snapshot: Snapshot | null;
  /** Whether the analyzer is running (clears SettlingLine's ring on stop). */
  running: boolean;
  /** The result being revealed (drives the in-place ScoreReveal); null while
   *  scanning. */
  revealResult: MorningResult | null;
  /** Repeat-capture compression — true for every vowel after the first. */
  compressed: boolean;
  /** ScoreReveal's onDone → advance the scan. */
  onRevealDone: () => void;
  /** User chose to skip this vowel — records a null result and advances. */
  onSkip: () => void;
}

/* ════════════════════════════ presence ring ════════════════════════════ */
/* A single calm ring whose stroke OPACITY breathes with the live steadiness
   EMA (forgiving present-tense reading — never the Index). The geometry is
   fixed; only brightness moves, so it reads as "the tone is being heard", not a
   meter. Plate ink, no color verdict. */

const RING_VIEW = 120; // viewBox units (square)
const RING_CX = RING_VIEW / 2;
const RING_CY = RING_VIEW / 2;
const RING_R = 46;
const RING_CIRC = 2 * Math.PI * RING_R;

// Brightness band: rest (dim) → steady (bright). Mirrors steadiness's coarse
// public surface — wide enough that it never reverse-engineers the Index.
const RING_DIM = 0.16; //  the faintest the ring ever draws (resting / silence)
const RING_BRIGHT = 0.92; // the brightest (a settled, clean hold)

/** Steadiness 0..1 → ring stroke opacity. */
function ringOpacity(v: number): number {
  return RING_DIM + (RING_BRIGHT - RING_DIM) * clamp01(v);
}

// the inner Om mark scales gently with steadiness too (a quiet "filling")
const OM_DIM = 0.32;
const OM_BRIGHT = 1.0;
function omOpacity(v: number): number {
  return OM_DIM + (OM_BRIGHT - OM_DIM) * clamp01(v);
}

/* ════════════════════════════ delays ═══════════════════════════════════ */
// The 'skip this vowel' affordance appears only after the user has had a calm
// moment to begin — never an instant escape hatch, never a punishing timer.
const SKIP_REVEAL_MS = 9000;

/* ════════════════════════════ component ════════════════════════════════ */

export default function VowelStep({
  item,
  stepIndex,
  total,
  results,
  snapshot,
  running,
  revealResult,
  compressed,
  onRevealDone,
  onSkip,
}: VowelStepProps): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const revealing = revealResult != null;

  /* ── the in-place reckoning ─────────────────────────────────────────────
     A null/skipped result carries no ceremony (ScoreReveal.index is a
     NON-nullable number) — fire onDone immediately so the flow never stalls. */
  const onRevealDoneRef = useRef(onRevealDone);
  onRevealDoneRef.current = onRevealDone;
  const nullRevealHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (revealResult != null && revealResult.coherenceIndex == null) {
      if (nullRevealHandledRef.current === revealResult.capturedAt) return;
      nullRevealHandledRef.current = revealResult.capturedAt;
      onRevealDoneRef.current();
    }
  }, [revealResult]);

  /* ── the breathing presence ring (rAF + reduced-motion static frame) ───── */
  const ringWrapRef = useRef<HTMLDivElement>(null);
  const ringStrokeRef = useRef<SVGCircleElement>(null);
  const omRef = useRef<HTMLSpanElement>(null);

  const snapRef = useRef<Snapshot | null>(snapshot);
  snapRef.current = snapshot;

  const emaRef = useRef<number>(STEADINESS_REST);

  // reset the EMA whenever a fresh hold begins (mic stops between scans)
  useEffect(() => {
    if (!running) emaRef.current = STEADINESS_REST;
  }, [running]);

  /** Paint the ring + Om mark at the given steadiness (no per-frame motion of
   *  geometry — only brightness, which is signal, like SettlingLine). */
  const paintRing = (v: number) => {
    const stroke = ringStrokeRef.current;
    if (stroke) stroke.setAttribute('opacity', ringOpacity(v).toFixed(3));
    const om = omRef.current;
    if (om) om.style.opacity = omOpacity(v).toFixed(3);
  };

  // Normal motion: advance the EMA in wall-clock time and breathe the ring.
  // The loop auto-pauses off-screen and never ticks under reduced motion.
  useRafLoop(ringWrapRef, (_t, dt) => {
    const s = snapRef.current;
    const target = s?.voiced ? blendReadings(steadinessReadings(s)) : STEADINESS_REST;
    emaRef.current = emaStep(emaRef.current, target, dt);
    paintRing(emaRef.current);
  });

  // Reduced motion (and the first paint): a composed static frame at the raw
  // present-tense steadiness — no breathing, but brightness is signal and may
  // still update as the hop changes (the parent re-renders ~12/s on each hop).
  useEffect(() => {
    if (!reduced) {
      paintRing(emaRef.current);
      return;
    }
    const s = snapRef.current;
    const raw = s?.voiced ? blendReadings(steadinessReadings(s)) : STEADINESS_REST;
    paintRing(raw);
  });

  /* ── the calm skip affordance, surfaced after a short delay ──────────────
     Re-armed per step (keyed on stepIndex); never shown during revealing. */
  const skipWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = skipWrapRef.current;
    if (!wrap) return;
    wrap.dataset.ready = 'false';
    if (revealing) return; // no skip mid-reckoning
    const id = window.setTimeout(() => {
      if (skipWrapRef.current) skipWrapRef.current.dataset.ready = 'true';
    }, SKIP_REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [stepIndex, revealing]);

  // a stable starting steadiness word (the SettlingLine carries its own; this
  // is the present-tense coaching word shown beneath the ring)
  const word = snapshot?.voiced
    ? steadinessWord(blendReadings(steadinessReadings(snapshot)))
    : 'finding it…';

  /* ── the 5-dot progress rail ────────────────────────────────────────────
     done → the detected-vowel glyph (or '·' when ambiguous/skipped), current →
     a ring, pending → a faint dot. */
  const rail = Array.from({ length: total }, (_, k) => {
    const done = results[k];
    const isCurrent = k === stepIndex && !done;
    let cls = styles.dot;
    let glyph = '·';
    if (done) {
      if (done.skipped) {
        cls = `${styles.dot} ${styles.dotSkipped}`;
        glyph = '·';
      } else {
        cls = `${styles.dot} ${styles.dotDone}`;
        glyph = (done.detectedVowel ?? done.promptKey).toUpperCase();
      }
    } else if (isCurrent) {
      cls = `${styles.dot} ${styles.dotCurrent}`;
      glyph = '·';
    }
    return (
      <span key={k} className={cls} aria-hidden="true">
        {glyph}
      </span>
    );
  });

  return (
    <div className={styles.root}>
      {/* the big phonetic cue */}
      <div className={styles.prompt}>
        <div className={styles.cueRow}>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.glyph}>{item.glyph}</span>
        </div>
        <span className={styles.hint}>{item.hint}</span>
      </div>

      <p className={styles.copy}>{item.copy}</p>

      {/* during 'revealing' with a real number: the in-place reckoning.
          A null/skipped reveal renders nothing here (onDone fired above). */}
      {revealing && revealResult.coherenceIndex != null ? (
        <ScoreReveal
          key={revealResult.capturedAt}
          className={styles.reveal}
          metrics={revealResult.subMetrics}
          index={revealResult.coherenceIndex}
          vowel={revealResult.detectedVowel}
          seconds={revealResult.durationSecs}
          compressed={compressed}
          onDone={onRevealDone}
        />
      ) : (
        <>
          {/* the breathing presence ring with the Om mark at its center */}
          <div ref={ringWrapRef} className={styles.ring}>
            <svg
              viewBox={`0 0 ${RING_VIEW} ${RING_VIEW}`}
              width="100%"
              height="100%"
              role="img"
              aria-label={`Holding ${item.label} — ${word}`}
            >
              {/* the resting track — a faint full circle */}
              <circle
                cx={RING_CX}
                cy={RING_CY}
                r={RING_R}
                fill="none"
                stroke="var(--plate-rule)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              {/* the living ring — opacity breathes with the live steadiness */}
              <circle
                ref={ringStrokeRef}
                cx={RING_CX}
                cy={RING_CY}
                r={RING_R}
                fill="none"
                stroke="var(--on-plate)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                opacity={RING_DIM}
                vectorEffect="non-scaling-stroke"
                transform={`rotate(-90 ${RING_CX} ${RING_CY})`}
              />
            </svg>
            {/* the Om mark, centered, gently filling with the tone */}
            <span
              ref={omRef}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--on-plate)',
                opacity: OM_DIM,
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            >
              <OmMark style={{ fontSize: '1.75rem' }} />
            </span>
          </div>

          {/* the converging pitch line + its own parked steadiness word */}
          <div className={styles.settling}>
            <SettlingLine snapshot={snapshot} running={running} />
          </div>

          {/* the calm 'still listening' + skip affordance (after a delay) */}
          <div ref={skipWrapRef} className={styles.listening} data-ready="false">
            <span className={styles.listeningWord}>still listening</span>
            <button type="button" className={styles.skip} onClick={onSkip}>
              skip this vowel
            </button>
          </div>
        </>
      )}

      {/* the progress rail */}
      <div
        className={styles.rail}
        role="status"
        aria-label={`Vowel ${stepIndex + 1} of ${total}`}
      >
        {rail}
      </div>
    </div>
  );
}
