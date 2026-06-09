import { useEffect, useRef } from 'react';
import { useCanvasSize } from './useCanvasSize';
import type { Snapshot } from '../types/snapshot';
import type { AnalyzerHistory } from '../hooks/useAnalyzer';

// Reference vowel targets, same coords as the Rust classifier (ui.rs TARGETS).
const TARGETS: ReadonlyArray<readonly [string, number, number]> = [
  ['i', 300, 2300],
  ['e', 530, 1850],
  ['a', 700, 1200],
  ['o', 500, 900],
  ['u', 350, 800],
];

export interface VowelChartProps {
  getHistory: () => AnalyzerHistory;
  snapshot: Snapshot | null;
}

/**
 * Vowel chart: F2 on X (reversed, high F2 at left), F1 on Y (down). Five labeled
 * target circles, a ~2 s fading amber trail, and the live point. Direct port of
 * crates/desktop/src/ui.rs draw_vowel_chart.
 */
export default function VowelChart({ getHistory, snapshot }: VowelChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(wrapRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size.pxW;
    canvas.height = size.pxH;
    const dpr = size.dpr;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#14171F';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#2E3650';
      ctx.lineWidth = dpr;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(231,226,214,0.63)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('vowel chart', 6 * dpr, 2 * dpr);

      const pad = 22 * dpr;
      const plot = { l: pad, t: 18 * dpr, r: W - pad, b: H - pad };
      const pw = plot.r - plot.l;
      const ph = plot.b - plot.t;
      if (pw <= 0 || ph <= 0) return;

      // Axis ranges (ui.rs). F2 on X reversed; F1 on Y down.
      const f2Lo = 700;
      const f2Hi = 2600; // appears at LEFT
      const f1Lo = 250;
      const f1Hi = 850; // appears at BOTTOM
      const xOf = (f2: number) =>
        plot.r - ((f2 - f2Lo) / (f2Hi - f2Lo)) * pw; // reversed: high F2 -> left
      const yOf = (f1: number) => plot.t + ((f1 - f1Lo) / (f1Hi - f1Lo)) * ph;

      // Axis hints (F2 reversed).
      ctx.fillStyle = 'rgba(231,226,214,0.35)';
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('(high) ←F2', plot.l, 4 * dpr);
      ctx.textAlign = 'right';
      ctx.fillText('F2→ (low)', plot.r, 4 * dpr);

      // Reference targets.
      for (const [v, f1, f2] of TARGETS) {
        const cx = xOf(f2);
        const cy = yOf(f1);
        ctx.strokeStyle = 'rgba(231,226,214,0.24)';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, 12 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(231,226,214,0.59)';
        ctx.font = `${12 * dpr}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v, cx, cy);
      }

      // Fading trail over the last ~2 s (ui.rs trail_hops = hops_per_sec*2).
      const snap = snapshot;
      const hps = snap?.hops_per_sec ?? 12;
      const latestHop = snap?.hop_index ?? 0;
      const history = getHistory().vowel;
      const trailHops = Math.max(hps * 2, 1);
      const trailStart = Math.max(latestHop - trailHops, 0);
      for (const [hop, f1, f2] of history) {
        if (hop < trailStart || f1 <= 0 || f2 <= 0) continue;
        const age = (latestHop - hop) / trailHops;
        const alpha = Math.max((1 - age) * 0.55, 0);
        ctx.fillStyle = `rgba(227,182,82,${alpha})`;
        ctx.beginPath();
        ctx.arc(xOf(f2), yOf(f1), 2.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Live dot.
      if (snap?.voiced && snap.f1 != null && snap.f2 != null && snap.f1 > 0 && snap.f2 > 0) {
        const p = [xOf(snap.f2), yOf(snap.f1)] as const;
        ctx.fillStyle = '#EDC766';
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#14171F';
        ctx.lineWidth = dpr;
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, getHistory, snapshot]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
