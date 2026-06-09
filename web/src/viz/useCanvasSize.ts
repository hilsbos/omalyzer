import { useEffect, useRef, useState } from 'react';

export interface CanvasSize {
  cssW: number;
  cssH: number;
  dpr: number;
  pxW: number;
  pxH: number;
}

/**
 * Observe a wrapper element's CSS box and the device-pixel ratio, returning the
 * backing-store size to use for a crisp (retina) canvas. Redraws on resize and
 * orientation change fall out of the size changing.
 */
export function useCanvasSize(ref: React.RefObject<HTMLElement>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({
    cssW: 1,
    cssH: 1,
    dpr: 1,
    pxW: 1,
    pxH: 1,
  });
  const lastRef = useRef('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cssW = Math.max(1, Math.round(r.width));
      const cssH = Math.max(1, Math.round(r.height));
      const pxW = Math.max(1, Math.round(cssW * dpr));
      const pxH = Math.max(1, Math.round(cssH * dpr));
      const key = `${cssW}x${cssH}@${dpr}`;
      if (key !== lastRef.current) {
        lastRef.current = key;
        setSize({ cssW, cssH, dpr, pxW, pxH });
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [ref]);

  return size;
}
