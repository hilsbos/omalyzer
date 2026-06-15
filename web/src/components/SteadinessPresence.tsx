import { useRef } from 'react';
import type { Snapshot } from '../types/snapshot';
import { usePrefersReducedMotion, useRafLoop } from './science/motion';
import {
  emaStep,
  glowOpacityString,
  steadinessReadings,
  blendReadings,
  steadinessWord,
  STEADINESS_REST,
  type SteadinessWord,
} from './steadiness';
import styles from './SteadinessPresence.module.css';

/* ── SteadinessPresence — the during-hold affordance ──────────────────────────
   Replaces the live Coherence number in the practice focus band. While a tone
   is held it shows a breathing GLOW (brightness tracks how clean the tone is
   THIS second) and a quiet WORD ("finding it…" → "settling…" → "steady",
   softening back when the tone wanders). It renders NO number, and the only
   scalar it ever exposes is the coarse glow opacity + a 3-state word — far too
   coarse to read back as a Coherence Index.

   The single Coherence Index appears ONLY at completion, via ScoreReveal. This
   is presence, not a score.

   Determinism / brand laws (motion.ts): the breathing comes from a 1 s EMA over
   real per-hop readings (no Math.random, no animation library); the rAF loop
   auto-pauses off-screen and never ticks under prefers-reduced-motion. Reduced
   motion → a composed STATIC frame fixed at the resting brightness/word — it
   does NOT track the live snapshot (tracking it would re-introduce breathing via
   React re-renders on every hop), so there is no motion at all.

   The latest Snapshot is read through a ref so the rAF closure always sees the
   current hop; the EMA accumulates in wall-clock time (dt) so its time-constant
   is frame-rate independent. */
export default function SteadinessPresence({ snapshot }: { snapshot: Snapshot | null }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);

  // latest snapshot for the loop closure + the EMA accumulator
  const snapRef = useRef<Snapshot | null>(snapshot);
  snapRef.current = snapshot;
  const emaRef = useRef<number>(STEADINESS_REST);
  // the last word written, so we only touch the DOM (and re-announce) on change
  const wordRef2 = useRef<SteadinessWord | null>(null);

  const applyWord = (w: SteadinessWord) => {
    if (wordRef2.current === w) return;
    wordRef2.current = w;
    if (wordRef.current) wordRef.current.textContent = w;
  };

  useRafLoop(rootRef, (_t, dt) => {
    const s = snapRef.current;
    const voiced = !!s?.voiced;
    const target = voiced && s ? blendReadings(steadinessReadings(s)) : STEADINESS_REST;
    emaRef.current = emaStep(emaRef.current, target, dt);
    const v = emaRef.current;
    if (glowRef.current) glowRef.current.style.opacity = glowOpacityString(v);
    applyWord(steadinessWord(v));
  });

  // Reduced motion / SSR-first frame: a composed STATIC frame fixed at the
  // RESTING brightness and resting word — no breathing. Crucially this does NOT
  // read the live snapshot: the component re-renders every hop (~60 Hz), so a
  // snapshot-derived value here would oscillate the inline opacity frame-to-frame
  // and re-introduce the very motion reduced-motion forbids. STEADINESS_REST is
  // the calm floor the EMA itself starts at; both the reduced-motion still and
  // the normal-motion FIRST paint seed to glowOpacity(STEADINESS_REST) so the
  // initial frame matches the EMA's starting point (no 0.10→0.17 first-frame jump)
  // — under normal motion the rAF loop then takes over from that same value.
  const staticWord = reduced ? steadinessWord(STEADINESS_REST) : 'finding it…';
  const staticGlow = glowOpacityString(STEADINESS_REST);

  return (
    <span ref={rootRef} className={styles.presence} aria-hidden="true">
      <span
        ref={glowRef}
        className={styles.glow}
        style={{ opacity: staticGlow }}
      />
      <span ref={wordRef} className={styles.word}>
        {staticWord}
      </span>
    </span>
  );
}
