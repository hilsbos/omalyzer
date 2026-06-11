/* ── /science atmosphere driver — the light→dark journey ────────────────────
   Model (per the locked concept, lean-drive graft): the descent gradient is
   STATIC CSS geometry painted on one full-document layer behind the page,
   with stops pinned to the seven <hr/> seams — scroll merely reveals it.
   Text never sits on mid-tone: every plunge through dusk happens INSIDE a
   seam gap; section grounds switch decisively. JS is reserved for:
   · measuring the seams (and re-measuring on resize/reflow/fonts-ready);
   · ONE rAF-throttled scroll comparator that flips the <meta theme-color>
     with a hysteresis band at the III→IV crossover (mobile chrome descends);
   · arming the one-shot nightfall horizon beat on the crossover rule.
   The `.sci-dark` token-remap scope (sections IV→CTA) is applied STATICALLY
   by the integrator — those sections always sit on dark ground, so contrast
   holds at every scroll position with zero toggling. Reduced-motion needs no
   special casing here: the atmosphere itself is static; the only animation
   (the horizon bloom) collapses via the global reduced-motion rule. */

import { useEffect, type RefObject } from 'react';
import './atmosphere.css';

/** Class the hook adds to the prose root (scopes hr tick styling). */
const PAGE_CLASS = 'sci-page';
/** Token-remap scope — integrator wraps sections IV→CTA in a div with this. */
export const DARK_SCOPE_CLASS = 'sci-dark';

const THEME_LIGHT = '#FAF7F1';
const THEME_DARK = '#11141C';

/* Gradient stop table (top→bottom). Light papers carry alpha E0 (~88%) so the
   body's warm grain ghosts faintly through and fades as you descend; from the
   plunge's indigo down the layer is fully opaque — the grain cannot ghost
   through the dark. Colors are the sanctioned stops only. */
const TOP = '#FAF7F100'; // transparent — hero + nav keep body's own parchment+grain
const PAPER_I = '#F4EFE5E0';
const PAPER_II = '#ECE5D6E0';
const PAPER_III = '#E6DECEE0';
const DUSK_INDIGO = '#2C2952'; // the colormap's indigo stop — the plunge
const DARK_IV = '#1B2030';
const DARK_V = '#14171F';
const DARK_VI = '#11141C'; // holds to the bottom (footer = cosmos)

const BAND = 72; // px half-width of each light seam transition
const PLUNGE_BAND = 110; // px half-width of the III→IV plunge
const HYSTERESIS = 96; // px band around the crossover for the theme-color flip
const CROSSOVER_SEAM = 3; // hr index of the III→IV seam

/**
 * Owns the whole descent. Call once from SciencePage with a ref to the
 * `<main className={styles.prose}>` element (which must contain the seven
 * top-level `<hr/>` seams). Creates/destroys the background layer, tags the
 * seams, pins the gradient, flips theme-color, marks the body for the footer
 * remap. Idempotent under StrictMode double-invoke; cleans up on unmount.
 */
export function useScienceAtmosphere(proseRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose || typeof window === 'undefined') return;

    prose.classList.add(PAGE_CLASS);
    document.body.setAttribute('data-science-dark', '');

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = meta?.content ?? THEME_LIGHT;

    const layer = document.createElement('div');
    layer.className = 'sci-atmosphere';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);

    let plungeY = Number.POSITIVE_INFINITY;
    let dark = false;

    const setTheme = (d: boolean) => {
      dark = d;
      if (meta) meta.content = d ? THEME_DARK : THEME_LIGHT;
      // The page must LAND dark at its edge: while in the dark half, the
      // <html> canvas itself goes #11141C, so macOS/iOS rubber-band overscroll
      // past the document end shows cosmos, not parchment+grain (body's bg
      // only propagates to the canvas while html carries none — so in the
      // light half, top overscroll still shows the warm paper). Same
      // rAF-throttled comparator + hysteresis as the theme-color flip.
      document.documentElement.classList.toggle('sci-canvas-dark', d);
    };

    const evalTheme = () => {
      const y = window.scrollY + window.innerHeight * 0.5; // viewport midline
      if (!dark && y > plungeY + HYSTERESIS) setTheme(true);
      else if (dark && y < plungeY - HYSTERESIS) setTheme(false);
    };

    /** Measure the seams and rebuild the static gradient. Read-then-write. */
    const measure = () => {
      // The absolutely-positioned layer itself extends the document's
      // scrollable overflow, so its previous height would hold scrollHeight
      // up and the measurement could only ever ratchet taller (permanent dark
      // scroll space after any reflow that shortens the page). Collapse it
      // before reading. Seam positions are viewport-relative + scrollY, so
      // they are unaffected by the collapse.
      layer.style.height = '0px';
      const hrs = Array.from(prose.querySelectorAll('hr'));
      const scrollY = window.scrollY;
      const seams = hrs.map((hr) => hr.getBoundingClientRect().top + scrollY);
      const docHeight = document.documentElement.scrollHeight;

      hrs.forEach((hr, i) => {
        hr.classList.add('sci-seam');
        hr.classList.toggle('sci-seam-dark', i >= CROSSOVER_SEAM);
      });

      layer.style.height = `${Math.ceil(docHeight)}px`;

      if (seams.length <= CROSSOVER_SEAM) {
        // Defensive: page structure changed — stay parchment, no descent.
        layer.style.backgroundImage = 'none';
        layer.style.removeProperty('--sci-plunge-y');
        plungeY = Number.POSITIVE_INFINITY;
        evalTheme();
        return;
      }

      plungeY = seams[CROSSOVER_SEAM];
      const px = (n: number) => `${Math.round(n)}px`;
      const stops: string[] = [`${TOP} 0px`];

      // Light paper steps — each transition lives inside its seam gap.
      const lightStops = [PAPER_I, PAPER_II, PAPER_III];
      let prev = TOP;
      for (let i = 0; i < CROSSOVER_SEAM && i < lightStops.length; i++) {
        stops.push(`${prev} ${px(seams[i] - BAND)}`);
        stops.push(`${lightStops[i]} ${px(seams[i] + BAND)}`);
        prev = lightStops[i];
      }

      // THE PLUNGE — dusk indigo at the seam, dark plate just below it.
      stops.push(`${prev} ${px(plungeY - PLUNGE_BAND)}`);
      stops.push(`${DUSK_INDIGO} ${px(plungeY)}`);
      stops.push(`${DARK_IV} ${px(plungeY + PLUNGE_BAND)}`);

      // Dark steps (IV→V, V→VI), then hold the console floor to the bottom.
      const darkStops = [DARK_V, DARK_VI];
      prev = DARK_IV;
      for (let i = 0; i < darkStops.length; i++) {
        const seam = seams[CROSSOVER_SEAM + 1 + i];
        if (seam === undefined) break;
        stops.push(`${prev} ${px(seam - BAND)}`);
        stops.push(`${darkStops[i]} ${px(seam + BAND)}`);
        prev = darkStops[i];
      }
      stops.push(`${DARK_VI} 100%`);

      layer.style.backgroundImage = `linear-gradient(to bottom, ${stops.join(', ')})`;
      layer.style.setProperty('--sci-plunge-y', px(plungeY + PLUNGE_BAND));
      evalTheme();
    };

    // rAF-throttled scroll comparator — two cached thresholds, writes only on
    // crossing. No layout reads on the scroll path.
    let scrollTicking = false;
    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        evalTheme();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Re-measure on any reflow: resize, content/layout changes, fonts.
    let measureRaf = 0;
    const requestMeasure = () => {
      cancelAnimationFrame(measureRaf);
      measureRaf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', requestMeasure);
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(requestMeasure) : undefined;
    ro?.observe(document.body);
    // Guarded: the promise outlives the effect (StrictMode double-invoke), so
    // a stale resolution must not re-measure against a torn-down layer.
    let disposed = false;
    if (document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (!disposed) requestMeasure();
        })
        .catch(() => {});
    }

    // Self-drawing registration marks: each seam draws itself on left→right
    // (500ms, house bezier — CSS transition on .sci-seam-drawn) as it reveals,
    // at the same scroll moment as the prose Reveal around it. Reduced motion
    // and no-IO environments get the composed final frame immediately.
    let seamObs: IntersectionObserver | undefined;
    const allHrs = Array.from(prose.querySelectorAll('hr'));
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      allHrs.forEach((hr) => hr.classList.add('sci-seam-drawn'));
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
      allHrs.forEach((hr) => seamObs?.observe(hr));
    }

    // One-shot nightfall horizon beat on the crossover rule. The bloom is a
    // pseudo-element of the same hr whose scaleX draw-on the seam observer
    // drives, so it is SEQUENCED: it may only start once the rule has landed
    // (transitionend on transform), or the 16rem horizon line would render
    // horizontally squashed mid-draw. Anticipation, then the reveal.
    let horizonObs: IntersectionObserver | undefined;
    let horizonTimer: number | undefined;
    let onSeamLanded: ((e: TransitionEvent) => void) | undefined;
    const crossoverHr = prose.querySelectorAll('hr')[CROSSOVER_SEAM];
    if (crossoverHr) {
      crossoverHr.classList.add('sci-horizon');
      const light = () => crossoverHr.classList.add('sci-horizon-lit');
      if (reducedMotion || typeof IntersectionObserver === 'undefined') {
        // No draw-on to wait for; the global reduced-motion rule collapses
        // the bloom to its final frame anyway.
        light();
      } else {
        let seamLanded = false;
        let pending = false;
        onSeamLanded = (e: TransitionEvent) => {
          if (e.propertyName !== 'transform' || e.target !== crossoverHr) return;
          seamLanded = true;
          if (pending) light();
        };
        crossoverHr.addEventListener('transitionend', onSeamLanded);
        horizonObs = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                if (seamLanded) light();
                else {
                  pending = true;
                  // Fallback: if the seam's transition never fires (e.g. the
                  // class landed before first paint), bloom after the draw's
                  // 500ms would have finished.
                  horizonTimer = window.setTimeout(light, 700);
                }
                horizonObs?.disconnect();
              }
            }
          },
          { rootMargin: '0px 0px -20% 0px' },
        );
        horizonObs.observe(crossoverHr);
      }
    }

    measure();

    return () => {
      disposed = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', requestMeasure);
      cancelAnimationFrame(measureRaf);
      ro?.disconnect();
      seamObs?.disconnect();
      horizonObs?.disconnect();
      if (horizonTimer !== undefined) window.clearTimeout(horizonTimer);
      if (crossoverHr && onSeamLanded) {
        crossoverHr.removeEventListener('transitionend', onSeamLanded);
      }
      layer.remove();
      prose.classList.remove(PAGE_CLASS);
      document.body.removeAttribute('data-science-dark');
      document.documentElement.classList.remove('sci-canvas-dark');
      if (meta) meta.content = prevTheme;
      prose.querySelectorAll('hr').forEach((hr) => {
        hr.classList.remove(
          'sci-seam',
          'sci-seam-dark',
          'sci-seam-drawn',
          'sci-horizon',
          'sci-horizon-lit',
        );
      });
    };
  }, [proseRef]);
}
