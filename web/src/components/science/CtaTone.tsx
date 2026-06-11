/* ── CTA bookend — the hero's settled tone, returned in print ───────────────
   The same summed-harmonic period the hero resolved into (identical math:
   harmonicAmps(12, 8) + goldenPhases, 3.5 clean cycles) redrawn once, static,
   in the page's own accent ink on the parchment ground — the hero's tone
   coming back as a printed line, quieter than the hero itself. Its ONLY
   motion is a slow 8s breathing opacity (CSS keyframes, animation-play-state
   gated by an IntersectionObserver so it is paused off-screen; reduced motion
   holds it steady at mid-breath). The page's last gesture: a tone that
   holds. */

import { useRef } from 'react';
import { goldenPhases, harmonicAmps, sumHarmonics, useInView } from './motion';
import { STROKE, TOKEN, VIEW } from './palette';
import styles from './CtaTone.module.css';

const W = VIEW.width;
const H = 56;
const CY = H / 2;
const GAIN = 22; // |y| ≤ 1 → trace stays well inside the band
const CYCLES = 3.5; // the hero's locked period, verbatim
const PTS = 220;

const AMPS = harmonicAmps(12, 8);
const PSIS = goldenPhases(12);

/** The settled waveform — computed once, deterministic, no rAF at all. */
const D = (() => {
  let d = '';
  for (let j = 0; j < PTS; j++) {
    const phi = 2 * Math.PI * CYCLES * (j / (PTS - 1));
    const y = sumHarmonics(phi, AMPS, PSIS);
    d += `${j ? 'L' : 'M'}${(((j / (PTS - 1)) * W).toFixed(1))} ${(CY - y * GAIN).toFixed(2)}`;
  }
  return d;
})();

export default function CtaTone({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Breathe only while on-screen (re-arms on exit; resumes just before entry).
  const breathing = useInView(svgRef, { rootMargin: '64px' });
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={[styles.root, !breathing && styles.paused, className]
        .filter(Boolean)
        .join(' ')}
    >
      <path
        d={D}
        fill="none"
        stroke={TOKEN.accent}
        strokeWidth={STROKE.line}
        strokeLinecap="butt"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
