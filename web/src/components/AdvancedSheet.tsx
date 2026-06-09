import { useState } from 'react';
import styles from './AdvancedSheet.module.css';

export interface DisplayControls {
  maxFreqHz: number;
  dbFloor: number;
  dbCeil: number;
}

export interface AdvancedSheetProps {
  controls: DisplayControls;
  onChange: (c: DisplayControls) => void;
  gateDb: number;
  onGateChange: (db: number) => void;
  storeMaxHz: number;
}

/**
 * Collapsible display controls. Three are display-only (max-freq, dB floor, dB
 * ceiling); the gate is the ONE control that feeds back into the DSP.
 */
export default function AdvancedSheet({
  controls,
  onChange,
  gateDb,
  onGateChange,
  storeMaxHz,
}: AdvancedSheetProps) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<DisplayControls>) => onChange({ ...controls, ...patch });

  return (
    <section className={styles.sheet}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Display & gate
      </button>
      {open && (
        <div className={styles.body}>
          <Slider
            label="max freq"
            min={200}
            max={storeMaxHz}
            step={50}
            value={controls.maxFreqHz}
            unit="Hz"
            onChange={(v) => set({ maxFreqHz: v })}
          />
          <Slider
            label="dB floor"
            min={-120}
            max={-50}
            step={1}
            value={controls.dbFloor}
            unit="dB"
            onChange={(v) => set({ dbFloor: Math.min(v, controls.dbCeil - 1) })}
          />
          <Slider
            label="dB ceil"
            min={-60}
            max={0}
            step={1}
            value={controls.dbCeil}
            unit="dB"
            onChange={(v) => set({ dbCeil: Math.max(v, controls.dbFloor + 1) })}
          />
          <Slider
            label="gate"
            min={-60}
            max={-30}
            step={1}
            value={gateDb}
            unit="dB"
            onChange={onGateChange}
            gate
          />
          <p className={styles.note}>
            Gate sets the silence threshold (the one control that affects analysis);
            the others only change the spectrogram display.
          </p>
        </div>
      )}
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  unit,
  onChange,
  gate = false,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  gate?: boolean;
}) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={gate ? `${styles.range} ${styles.rangeGate}` : styles.range}
      />
      <span className={styles.sliderValue}>
        {value} {unit}
      </span>
    </label>
  );
}
