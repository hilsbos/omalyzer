import { useEffect, useRef } from 'react';
import { useCanvasSize } from './useCanvasSize';
import type { AnalyzerHistory } from '../hooks/useAnalyzer';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface PitchTrackProps {
  getHistory: () => AnalyzerHistory;
  latestHop: number;
}

/**
 * Pitch track: voiced F0 over the recent window on a log-frequency y-axis with
 * faint semitone gridlines and octave (C) note labels. Direct transcription of
 * crates/desktop/src/ui.rs draw_pitch_track (65–550 Hz clamp, green line broken
 * across >2-hop gaps).
 */
export default function PitchTrack({ getHistory, latestHop }: PitchTrackProps) {
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
      ctx.fillText('pitch track', 6 * dpr, 2 * dpr);

      const titleH = 16 * dpr;
      const left = 34 * dpr;
      const plot = {
        l: left,
        t: titleH,
        r: W - 4 * dpr,
        b: H - 4 * dpr,
      };
      const pw = plot.r - plot.l;
      const ph = plot.b - plot.t;
      if (pw <= 0 || ph <= 0) return;

      const history = getHistory().pitch;

      // Frequency range: fit history with padding, clamped to chant range.
      let fmin = Infinity;
      let fmax = -Infinity;
      for (const [, f] of history) {
        if (f > 0) {
          if (f < fmin) fmin = f;
          if (f > fmax) fmax = f;
        }
      }
      if (!Number.isFinite(fmin) || !Number.isFinite(fmax)) {
        fmin = 100;
        fmax = 400;
      }
      fmin = Math.max(fmin / 1.12, 65);
      fmax = Math.min(fmax * 1.12, 550);
      if (fmax <= fmin * 1.05) fmax = fmin * 1.5;

      const lfMin = Math.log(fmin);
      const lfMax = Math.log(fmax);
      const yOf = (f: number) => {
        const t = (Math.log(Math.max(f, 1)) - lfMin) / (lfMax - lfMin);
        return plot.b - Math.min(Math.max(t, 0), 1) * ph;
      };

      // Semitone gridlines; label C notes ~ every octave.
      const midiLo = Math.ceil(69 + 12 * Math.log2(fmin / 440));
      const midiHi = Math.floor(69 + 12 * Math.log2(fmax / 440));
      ctx.lineWidth = Math.max(dpr * 0.5, 1);
      for (let midi = midiLo; midi <= midiHi; midi++) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        const y = yOf(f);
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        const alpha = isOctave ? 0.24 : 0.086;
        ctx.strokeStyle = `rgba(231,226,214,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(plot.l, y);
        ctx.lineTo(plot.r, y);
        ctx.stroke();
        if (isOctave) {
          const name = NOTE_NAMES[(((midi % 12) + 12) % 12)];
          const octave = Math.floor(midi / 12) - 1;
          ctx.fillStyle = 'rgba(231,226,214,0.55)';
          ctx.font = `${9 * dpr}px ui-monospace, monospace`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${name}${octave}`, 4 * dpr, y);
        }
      }

      if (history.length === 0) return;

      // Time axis: latest_hop on the right, visible span to the left.
      const oldest = history[0][0];
      const windowHops = Math.max(latestHop - oldest, 1);
      const xOf = (hop: number) => plot.r - ((latestHop - hop) / windowHops) * pw;

      // F0 line, broken across >2-hop gaps (unvoiced spans). Slate-blue trace.
      ctx.strokeStyle = '#8FB4E6';
      ctx.lineWidth = Math.max(dpr * 1.5, 1);
      let prev: [number, number, number] | null = null;
      for (const [hop, f] of history) {
        if (f <= 0) continue;
        const x = xOf(hop);
        const y = yOf(f);
        if (prev && hop - prev[2] <= 2) {
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        prev = [x, y, hop];
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, getHistory, latestHop]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
