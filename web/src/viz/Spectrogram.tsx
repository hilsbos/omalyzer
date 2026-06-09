import { useEffect, useRef } from 'react';
import { buildColormapLut } from './colormap';
import { useCanvasSize } from './useCanvasSize';
import type { Snapshot } from '../types/snapshot';
import type { AnalyzerHistory } from '../hooks/useAnalyzer';

const LUT = buildColormapLut();

export interface SpectrogramProps {
  getHistory: () => AnalyzerHistory;
  snapshot: Snapshot | null;
  maxFreqHz: number;
  dbFloor: number;
  dbCeil: number;
}

/**
 * Scrolling low-frequency spectrogram. Mirrors crates/desktop/src/ui.rs
 * draw_spectrogram + draw_spectrogram_overlay: magma colormap, NEAREST scaling,
 * Hz gridlines, harmonic ticks at k*F0, and F1/F2/F3 lines. The retained raw dB
 * columns are re-rendered each frame so range/contrast/max-freq changes apply.
 */
export default function Spectrogram({
  getHistory,
  snapshot,
  maxFreqHz,
  dbFloor,
  dbCeil,
}: SpectrogramProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufRef = useRef<HTMLCanvasElement | null>(null);
  const size = useCanvasSize(wrapRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size.pxW;
    canvas.height = size.pxH;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const snap = snapshot;
      const binHz = snap?.bin_hz ?? 0;
      const storedBins = snap?.stored_bins ?? 0;
      const columns = getHistory().columns;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (binHz <= 0 || storedBins <= 0 || columns.length === 0) return;

      // Display bins clamp (ui.rs: clamp(maxFreq/binHz, 2, storedBins)).
      const displayBins = Math.min(
        Math.max(Math.floor(maxFreqHz / binHz), 2),
        Math.max(storedBins, 2),
      );
      const W = columns.length;
      const H = displayBins;
      const range = Math.max(dbCeil - dbFloor, 1);

      // Render the dB history into a logical W*H buffer via one ImageData.
      let buf = bufRef.current;
      if (!buf) {
        buf = document.createElement('canvas');
        bufRef.current = buf;
      }
      buf.width = W;
      buf.height = H;
      const bctx = buf.getContext('2d');
      if (!bctx) return;
      const img = bctx.createImageData(W, H);
      const data = img.data;
      for (let x = 0; x < W; x++) {
        const col = columns[x];
        for (let y = 0; y < H; y++) {
          const bin = H - 1 - y; // top = highest frequency
          const db = bin < col.length ? col[bin] : dbFloor;
          let t = (db - dbFloor) / range;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const li = ((t * 255) | 0) * 3;
          const di = (y * W + x) * 4;
          data[di] = LUT[li];
          data[di + 1] = LUT[li + 1];
          data[di + 2] = LUT[li + 2];
          data[di + 3] = 255;
        }
      }
      bctx.putImageData(img, 0, 0);

      // Blit buffer -> visible canvas, NEAREST (ui.rs TextureOptions::NEAREST).
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, W, H, 0, 0, canvas.width, canvas.height);

      drawOverlay(ctx, canvas.width, canvas.height, maxFreqHz, snap, size.dpr);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, snapshot, getHistory, maxFreqHz, dbFloor, dbCeil]);

  return (
    <div
      ref={wrapRef}
      style={{ width: '100%', height: '100%', minHeight: 0, background: '#000' }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// Hz gridlines + labels, harmonic ticks, and F1/F2/F3 lines — ports ui.rs.
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  maxFreq: number,
  snap: Snapshot | null,
  dpr: number,
) {
  if (maxFreq <= 0 || h <= 0) return;
  const yOf = (f: number) => h - (f / maxFreq) * h;
  const fs = Math.max(10 * dpr, 10);
  ctx.font = `${fs}px ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';

  // Frequency gridlines (ui.rs step rule).
  const step = maxFreq <= 600 ? 50 : maxFreq <= 1500 ? 100 : 500;
  ctx.lineWidth = Math.max(dpr * 0.5, 1);
  for (let f = step; f < maxFreq; f += step) {
    const y = yOf(f);
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.47)';
    ctx.textAlign = 'left';
    ctx.fillText(`${f.toFixed(0)} Hz`, 4 * dpr, y - 2 * dpr);
  }

  // Harmonic ticks at k*F0 along the right edge (ui.rs k=1..20).
  const f0 = snap?.f0 ?? null;
  if (f0 != null && f0 > 0) {
    const tickLen = 10 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = Math.max(dpr * 1.5, 1);
    for (let k = 1; k <= 20; k++) {
      const fk = k * f0;
      if (fk >= maxFreq) break;
      const y = yOf(fk);
      ctx.beginPath();
      ctx.moveTo(w - tickLen, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // F1/F2/F3 lines + labels (ui.rs colors, ~0.65 gamma on the line).
  const formant = (
    freq: number | null | undefined,
    line: string,
    label: string,
    text: string,
  ) => {
    if (freq == null || !(freq > 0) || freq >= maxFreq) return;
    const y = yOf(freq);
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(dpr * 1.5, 1);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w - 12 * dpr, y);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w - 14 * dpr, y);
    ctx.textBaseline = 'alphabetic';
  };
  // line uses ~0.65 gamma of the label color (ui.rs gamma_multiply(0.65)).
  formant(snap?.f1, 'rgb(196,78,78)', 'F1', 'rgb(255,120,120)');
  formant(snap?.f2, 'rgb(78,154,210)', 'F2', 'rgb(120,200,255)');
  formant(snap?.f3, 'rgb(138,210,90)', 'F3', 'rgb(180,255,140)');
}
