/* ── /science seam micro-moments ─────────────────────────────────────────────
   The page lives entirely in the light editorial world (brand rule: light =
   reading, dark = measuring — the dark belongs to /analyze). This hook owns
   only the two seam micro-moments:
   · each top-level <hr/> becomes a graticule registration mark that draws
     itself left→right (~500ms, house bezier) as it scrolls into view;
   · the `.sci-page` class scopes the roman-numeral channel ticks.
   Reduced motion / no-IntersectionObserver environments get the composed
   final frame immediately, so rules never vanish. */

import { useEffect, type RefObject } from 'react';
import './seams.css';

/** Class the hook adds to the prose root (scopes hr tick + roman styling). */
const PAGE_CLASS = 'sci-page';

/**
 * Call once from SciencePage with a ref to the `<main className={styles.prose}>`
 * element (which contains the top-level `<hr/>` seams). Idempotent under
 * StrictMode double-invoke; cleans up on unmount.
 */
export function useScienceSeams(proseRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose || typeof window === 'undefined') return;

    prose.classList.add(PAGE_CLASS);

    // Self-drawing registration marks: each seam draws itself on left→right
    // as it reveals, at the same scroll moment as the prose Reveal around it.
    let seamObs: IntersectionObserver | undefined;
    const hrs = Array.from(prose.querySelectorAll('hr'));
    hrs.forEach((hr) => hr.classList.add('sci-seam'));
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      hrs.forEach((hr) => hr.classList.add('sci-seam-drawn'));
    } else {
      seamObs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add('sci-seam-drawn');
              seamObs?.unobserve(entry.target);
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px' },
      );
      hrs.forEach((hr) => seamObs?.observe(hr));
    }

    return () => {
      seamObs?.disconnect();
      prose.classList.remove(PAGE_CLASS);
      hrs.forEach((hr) => hr.classList.remove('sci-seam', 'sci-seam-drawn'));
    };
  }, [proseRef]);
}
