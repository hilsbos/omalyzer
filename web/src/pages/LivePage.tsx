import { useCallback, useRef, useState } from 'react';
import { useAnalyzer } from '../hooks/useAnalyzer';
import type { Snapshot } from '../types/snapshot';
import Hero from '../components/Hero';
import CoherencePanel from '../components/CoherencePanel';
import StateSignals from '../components/StateSignals';
import AdvancedSheet, { type DisplayControls } from '../components/AdvancedSheet';
import TabBar, { type SecondaryTab } from '../components/TabBar';
import Spectrogram from '../viz/Spectrogram';
import PitchTrack from '../viz/PitchTrack';
import VowelChart from '../viz/VowelChart';
import styles from './LivePage.module.css';

const RECORD_SECONDS = 5;
const STORE_MAX_HZ = 4000; // matches core STORE_MAX_HZ

const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

function meanOf(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export default function LivePage() {
  const { snapshot, status, start, stop, peek, getHistory, gateDb, setGate } = useAnalyzer();
  const [controls, setControls] = useState<DisplayControls>({
    maxFreqHz: 1000,
    dbFloor: -90,
    dbCeil: -30,
  });
  const [tab, setTab] = useState<SecondaryTab>('coherence');
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<RecordResult | null>(null);
  const recTimerRef = useRef<number | null>(null);

  const s: Snapshot | null = snapshot;
  const latestHop = s?.hop_index ?? 0;

  const record = useCallback(() => {
    if (!status.running || recording) return;
    setRecording(true);
    setResult(null);
    const frames: Snapshot[] = [];
    const id = window.setInterval(() => {
      const snap = peek();
      if (snap) frames.push(snap);
    }, 50);
    recTimerRef.current = id;
    window.setTimeout(() => {
      window.clearInterval(id);
      recTimerRef.current = null;
      const last = frames.length ? frames[frames.length - 1] : null;
      const voicedFraction = frames.length
        ? frames.filter((fr) => fr.voiced).length / frames.length
        : 0;
      const res: RecordResult = {
        capturedAt: new Date().toISOString(),
        windowSeconds: RECORD_SECONDS,
        frames: frames.length,
        sampleRate: status.sampleRate,
        settings: status.settings,
        warnings: status.warnings,
        averaged: {
          voicedFraction,
          f0Hz: meanOf(frames.filter((fr) => fr.voiced).map((fr) => fr.f0)),
          hnrDb: meanOf(frames.filter((fr) => fr.voiced).map((fr) => fr.hnr_db)),
          rmsDb: meanOf(frames.map((fr) => fr.rms_db)),
          liveCoherenceIndex: meanOf(frames.map((fr) => fr.live_coherence_index)),
        },
        lastCoherence: {
          index: last?.last_coherence_index ?? null,
          secs: last?.last_coherence_secs ?? 0,
          vowel: last?.last_coherence_vowel ?? null,
          pitchCoherence: last?.pitch_coherence ?? null,
          amplitudeCoherence: last?.amplitude_coherence ?? null,
          harmonicCoherence: last?.harmonic_coherence ?? null,
          spectralStability: last?.spectral_stability ?? null,
          resonanceMatch: last?.resonance_match ?? null,
        },
      };
      setResult(res);
      setRecording(false);
    }, RECORD_SECONDS * 1000);
  }, [status, recording, peek]);

  const downloadJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omalyzer-${result.capturedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className={styles.app}>
      {/* Toolbar */}
      <div className={`${styles.toolbar} ${styles.toolbarBar}`}>
        <span className={styles.toolbarTitle}>Omalyzer — Live</span>
        <span>
          {status.sampleRate ? `${status.sampleRate} Hz` : 'sample rate —'}
        </span>
        <button
          type="button"
          className={styles.recordBtn}
          onClick={record}
          disabled={!status.running || recording}
        >
          {recording ? `Recording ${RECORD_SECONDS}s…` : `Record ${RECORD_SECONDS}s + export JSON`}
        </button>
        {status.error && <span className={styles.error}>{status.error}</span>}
        {status.warnings.length > 0 && (
          <span className={styles.warn}>⚠ {status.warnings.join('  |  ')}</span>
        )}
      </div>

      {/* Hero */}
      <div className={styles.hero}>
        <Hero snapshot={s} running={status.running} onStart={start} onStop={stop} />
      </div>

      {/* Spectrogram */}
      <div className={styles.spectro}>
        <Spectrogram
          getHistory={getHistory}
          snapshot={s}
          maxFreqHz={controls.maxFreqHz}
          dbFloor={controls.dbFloor}
          dbCeil={controls.dbCeil}
        />
      </div>

      {/* Phone tab bar (hidden on desktop) */}
      <div className={styles.tabbar}>
        <TabBar value={tab} onChange={setTab} />
      </div>

      {/* Secondary panels. On phone only the active one shows (data-active);
          on desktop all four show, each reassigned to its own grid area. */}
      <div
        className={`${styles.secondary} ${styles.secondaryItem} ${styles.secCoherence}`}
        data-active={tab === 'coherence'}
      >
        <CoherencePanel snapshot={s} />
      </div>
      <div
        className={`${styles.secondary} ${styles.secondaryItem} ${styles.secState}`}
        data-active={tab === 'state'}
      >
        <StateSignals snapshot={s} />
      </div>
      <div
        className={`${styles.secondary} ${styles.secondaryItem} ${styles.secPitch} ${styles.secondaryCanvasItem}`}
        data-active={tab === 'pitch'}
      >
        <PitchTrack getHistory={getHistory} latestHop={latestHop} />
      </div>
      <div
        className={`${styles.secondary} ${styles.secondaryItem} ${styles.secVowel} ${styles.secondaryCanvasItem}`}
        data-active={tab === 'vowel'}
      >
        <VowelChart getHistory={getHistory} snapshot={s} />
      </div>

      {/* Advanced sheet */}
      <div className={styles.advanced}>
        <AdvancedSheet
          controls={controls}
          onChange={setControls}
          gateDb={gateDb}
          onGateChange={setGate}
          storeMaxHz={STORE_MAX_HZ}
        />
        {result && (
          <div className={styles.export} style={{ marginTop: '0.5rem' }}>
            <strong>
              Recorded {result.windowSeconds}s window ({result.frames} samples)
            </strong>
            <p className={styles.exportNote}>
              A within-person acoustic measure, not a diagnosis. Use this export to
              compare capture fidelity across devices (built-in vs. Bluetooth, etc.).
              f0 {f1(result.averaged.f0Hz)} Hz · HNR {f1(result.averaged.hnrDb)} dB
            </p>
            <pre className={styles.pre}>{JSON.stringify(result.averaged, null, 2)}</pre>
            <button type="button" className={styles.recordBtn} onClick={downloadJson}>
              Download JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface RecordResult {
  capturedAt: string;
  windowSeconds: number;
  frames: number;
  sampleRate: number | null;
  settings: MediaTrackSettings | null;
  warnings: string[];
  averaged: {
    voicedFraction: number;
    f0Hz: number | null;
    hnrDb: number | null;
    rmsDb: number | null;
    liveCoherenceIndex: number | null;
  };
  lastCoherence: {
    index: number | null;
    secs: number;
    vowel: string | null;
    pitchCoherence: number | null;
    amplitudeCoherence: number | null;
    harmonicCoherence: number | null;
    spectralStability: number | null;
    resonanceMatch: number | null;
  };
}
