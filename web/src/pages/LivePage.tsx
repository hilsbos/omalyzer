import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalyzer } from '../hooks/useAnalyzer';
import type { Snapshot } from '../types/snapshot';
import CoherencePanel from '../components/CoherencePanel';
import StateSignals from '../components/StateSignals';
import AdvancedSheet, { type DisplayControls } from '../components/AdvancedSheet';
import TabBar, { type SecondaryTab } from '../components/TabBar';
import ConsentStep, { type ConsentChoice } from '../components/ConsentStep';
import Spectrogram from '../viz/Spectrogram';
import PitchTrack from '../viz/PitchTrack';
import VowelChart from '../viz/VowelChart';
import { useAuth } from '../auth/AuthProvider';
import { saveOm, type OmContribution } from '../lib/contributions';
import styles from './LivePage.module.css';

const RECORD_SECONDS = 5;
const STORE_MAX_HZ = 4000; // matches core STORE_MAX_HZ

const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

function meanOf(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** A coarse capture-device hint stored as a fidelity covariate (not identifying). */
function deriveDeviceLabel(settings: MediaTrackSettings | null): string | null {
  const isMobile =
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const kind = isMobile ? 'mobile' : 'desktop';
  const label = (settings as { label?: string } | null)?.label;
  return label ? `${kind} · ${label}` : kind;
}

export default function LivePage() {
  const {
    snapshot,
    status,
    start,
    stop,
    peek,
    getHistory,
    gateDb,
    setGate,
    startRecording,
    stopRecording,
  } = useAnalyzer();
  const { session } = useAuth();
  const [controls, setControls] = useState<DisplayControls>({
    maxFreqHz: 1000,
    dbFloor: -90,
    dbCeil: -30,
  });
  const [tab, setTab] = useState<SecondaryTab>('coherence');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<RecordResult | null>(null);
  const recTimerRef = useRef<number | null>(null);
  // The retained mono PCM for the most recent record window (FLAC source).
  const pcmRef = useRef<Float32Array | null>(null);
  // The last detail-bearing snapshot of the window (feeds om_features).
  const detailRef = useRef<Snapshot | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const s: Snapshot | null = snapshot;
  const latestHop = s?.hop_index ?? 0;

  // ── Transport: elapsed timer (wraps start/stop; never touches DSP) ──────────
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTsRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  const handleStart = useCallback(() => {
    void start();
    startTsRef.current = performance.now();
    setElapsedMs(0);
    if (elapsedTimerRef.current == null) {
      elapsedTimerRef.current = window.setInterval(() => {
        if (startTsRef.current != null) {
          setElapsedMs(performance.now() - startTsRef.current);
        }
      }, 500);
    }
  }, [start]);

  const handleStop = useCallback(() => {
    stop();
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    startTsRef.current = null;
    setElapsedMs(0);
  }, [stop]);

  useEffect(
    () => () => {
      if (elapsedTimerRef.current != null) window.clearInterval(elapsedTimerRef.current);
    },
    [],
  );

  const mmss = (ms: number) => {
    const t = Math.floor(ms / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };

  // ── Live level meter: rms_db [-60,0] → [0,1] → N segments ──
  const LEVEL_SEGMENTS = 12;
  const levelNorm = Math.min(1, Math.max(0, ((s?.rms_db ?? -60) + 60) / 60));
  const levelLit = Math.round(levelNorm * LEVEL_SEGMENTS);

  // A completed recording surfaces a "results ready — open" affordance until
  // the user opens the drawer to act on it.
  const hasUnseenResult = result != null && !drawerOpen;

  const openResults = useCallback(() => setDrawerOpen(true), []);

  const record = useCallback(() => {
    if (!status.running || recording) return;
    setRecording(true);
    setResult(null);
    setSaveState('idle');
    setSaveError(null);
    pcmRef.current = null;
    detailRef.current = null;
    startRecording(); // begin the parallel raw-PCM tap
    const frames: Snapshot[] = [];
    const id = window.setInterval(() => {
      const snap = peek();
      if (snap) frames.push(snap);
    }, 50);
    recTimerRef.current = id;
    window.setTimeout(() => {
      window.clearInterval(id);
      recTimerRef.current = null;
      pcmRef.current = stopRecording(); // pull the concatenated mono PCM
      const last = frames.length ? frames[frames.length - 1] : null;
      detailRef.current = last;
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
  }, [status, recording, peek, startRecording, stopRecording]);

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

  const handleSave = useCallback(
    async (choice: ConsentChoice) => {
      if (!result || !pcmRef.current || !result.sampleRate) {
        setSaveError('Nothing captured to save — record a tone first.');
        return;
      }
      const pcm = pcmRef.current;
      const d = detailRef.current; // the last snapshot of the window (detail block)
      setSaveState('saving');
      setSaveError(null);
      try {
        const deviceLabel = deriveDeviceLabel(result.settings);
        const contribution: OmContribution = {
          pcm,
          sampleRate: result.sampleRate,
          durationSecs: result.windowSeconds,
          vowel: result.lastCoherence.vowel ?? d?.vowel ?? null,
          note: d?.note ?? null,
          f0Mean: result.averaged.f0Hz,
          deviceLabel,
          micSettings: result.settings,
          consentShare: choice.share,
          coherenceIndex: result.lastCoherence.index,
          subMetrics: {
            pitch_coherence: result.lastCoherence.pitchCoherence,
            amplitude_coherence: result.lastCoherence.amplitudeCoherence,
            harmonic_coherence: result.lastCoherence.harmonicCoherence,
            spectral_stability: result.lastCoherence.spectralStability,
            resonance_match: result.lastCoherence.resonanceMatch,
          },
          hnrDb: d?.detail_hnr_db ?? result.averaged.hnrDb,
          jitterCents: d?.detail_f0_cents_std ?? null,
          alphaRatioDb: d?.detail_alpha_ratio_db ?? null,
          cppsDb: d?.detail_cpps_db ?? null,
          formants: {
            f1: d?.f1 ?? null,
            f2: d?.f2 ?? null,
            f3: d?.f3 ?? null,
            bandwidth_hz: d?.detail_bandwidth_hz ?? null,
          },
          // The wider Snapshot detail superset (mirrors the JSON export).
          rawFeatures: {
            shimmer: d?.detail_shimmer ?? null,
            rms_cv: d?.detail_rms_cv ?? null,
            entropy: d?.detail_entropy ?? null,
            flux: d?.detail_flux ?? null,
            vowel_conf: d?.detail_vowel_conf ?? null,
            f0_var_st: d?.detail_f0_var_st ?? null,
            mean_f0_hz: d?.detail_mean_f0_hz ?? null,
            voiced_fraction: result.averaged.voicedFraction,
            frames: result.frames,
            warnings: result.warnings,
          },
        };
        await saveOm(contribution);
        setSaveState('saved');
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        setSaveState('idle');
      }
    },
    [result],
  );

  return (
    <div className={`${styles.console} instrument`} data-running={status.running}>
      {/* ── APP BAR ─────────────────────────────────────────────────────────── */}
      <header className={styles.appbar}>
        <Link to="/" className={styles.brand} aria-label="omalyzer home">
          <span className={styles.om}>ॐ</span>
          <span className={styles.wordmark}>omalyzer</span>
          <span className={styles.liveTag}>· LIVE</span>
        </Link>
        <span className={styles.appbarSpacer} />
        <span className={styles.device}>
          {status.sampleRate ? `${(status.sampleRate / 1000).toFixed(0)} kHz` : '— kHz'}
        </span>
        <span className={styles.sep}>·</span>
        <span className={styles.device}>{deriveDeviceLabel(status.settings) ?? 'Mic'}</span>
        <span
          className={styles.statusDot}
          data-state={recording ? 'rec' : status.running ? 'live' : 'idle'}
          aria-label={recording ? 'recording' : status.running ? 'live' : 'idle'}
        />
        <button
          type="button"
          className={styles.gear}
          aria-label="controls and results"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          ⚙{hasUnseenResult && <span className={styles.gearDot} aria-hidden />}
        </button>
      </header>

      {/* Warnings / errors strip (honest framing, kept verbatim). */}
      {(status.error || status.warnings.length > 0) && (
        <div className={styles.alerts}>
          {status.error && <span className={styles.error}>{status.error}</span>}
          {status.warnings.length > 0 && (
            <span className={styles.warn}>⚠ {status.warnings.join('  |  ')}</span>
          )}
        </div>
      )}

      {/* ── SPECTROGRAM — the hero plate (cols 1–2, top row) ─────────────────── */}
      <section className={`${styles.cell} ${styles.spectro}`} data-active="true">
        <div className={styles.cellHead}>spectrogram · 0–{STORE_MAX_HZ} Hz</div>
        <div className={styles.cellBody}>
          <Spectrogram
            getHistory={getHistory}
            snapshot={s}
            maxFreqHz={controls.maxFreqHz}
            dbFloor={controls.dbFloor}
            dbCeil={controls.dbCeil}
          />
        </div>
      </section>

      {/* ── RIGHT RAIL — coherence dial + sub-metrics + measured│inferred ────── */}
      <aside
        className={`${styles.cell} ${styles.rail}`}
        data-active={tab === 'coherence' || tab === 'state'}
      >
        <div className={styles.cellHead}>coherence · state signals</div>
        <div className={styles.cellBody}>
          <div className={styles.railScroll}>
            <CoherencePanel snapshot={s} />
            <StateSignals snapshot={s} />
          </div>
        </div>
      </aside>

      {/* ── PITCH — col 1, lower row ─────────────────────────────────────────── */}
      <section className={`${styles.cell} ${styles.pitch}`} data-active={tab === 'pitch'}>
        <div className={styles.cellHead}>∿ pitch track · F0 over time</div>
        <div className={styles.cellBody}>
          <PitchTrack getHistory={getHistory} latestHop={latestHop} />
        </div>
      </section>

      {/* ── VOWEL — col 2, lower row ─────────────────────────────────────────── */}
      <section className={`${styles.cell} ${styles.vowel}`} data-active={tab === 'vowel'}>
        <div className={styles.cellHead}>◇ vowel · F1×F2 formant space</div>
        <div className={styles.cellBody}>
          <VowelChart getHistory={getHistory} snapshot={s} />
        </div>
      </section>

      {/* Phone-only tab bar — hidden on the console grid. */}
      <div className={styles.tabbar}>
        <TabBar value={tab} onChange={setTab} />
      </div>

      {/* ── TRANSPORT ───────────────────────────────────────────────────────── */}
      <footer className={styles.transport}>
        <button
          type="button"
          className={styles.startStop}
          data-running={status.running}
          onClick={status.running ? handleStop : handleStart}
          aria-pressed={status.running}
        >
          {status.running ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          className={styles.recBtn}
          data-recording={recording}
          onClick={record}
          disabled={!status.running || recording}
        >
          ● {recording ? `REC ${RECORD_SECONDS}s…` : 'Record'}
        </button>

        <span className={styles.elapsed} aria-label="elapsed">
          {mmss(elapsedMs)}
        </span>

        {/* LIVE LEVEL METER from snapshot.rms_db */}
        <div
          className={styles.meter}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={levelNorm}
          aria-label="input level"
        >
          {Array.from({ length: LEVEL_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={styles.seg}
              data-lit={i < levelLit}
              data-hot={i >= LEVEL_SEGMENTS - 2}
            />
          ))}
        </div>
        <span className={styles.levelDb}>{s ? `${s.rms_db.toFixed(0)} dB` : '— dB'}</span>

        <span className={styles.transportMeta}>
          gate {gateDb} dB <span className={styles.sep}>·</span> vowel{' '}
          <span className={styles.vowel}>{s?.voiced && s.vowel ? s.vowel : '—'}</span>
        </span>

        <span className={styles.transportSpacer} />

        {hasUnseenResult && (
          <button type="button" className={styles.resultPill} onClick={openResults}>
            results ready — open ▸
          </button>
        )}
        <button
          type="button"
          className={styles.drawerToggle}
          aria-label="controls and results"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          Controls & results
        </button>
      </footer>

      {/* ── DRAWER (slide-over) — advanced controls + record results / save ──── */}
      {drawerOpen && (
        <>
          <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className={styles.drawer} role="dialog" aria-label="Controls and results">
            <div className={styles.drawerHead}>
              <span>controls &amp; results</span>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setDrawerOpen(false)}
                aria-label="close"
              >
                ×
              </button>
            </div>

            {/* Display & gate controls (gate is the one DSP control). */}
            <AdvancedSheet
              controls={controls}
              onChange={setControls}
              gateDb={gateDb}
              onGateChange={setGate}
              storeMaxHz={STORE_MAX_HZ}
            />

            {/* Record RESULT + export + consent/save flow — copy preserved verbatim. */}
            {result ? (
              <div className={styles.export}>
                <strong>
                  Recorded {result.windowSeconds}s window ({result.frames} samples)
                </strong>
                <p className={styles.exportNote}>
                  A within-person acoustic measure. Use this export to compare
                  capture fidelity across devices (built-in vs. Bluetooth, etc.). f0{' '}
                  {f1(result.averaged.f0Hz)} Hz · HNR {f1(result.averaged.hnrDb)} dB
                </p>
                <pre className={styles.pre}>{JSON.stringify(result.averaged, null, 2)}</pre>
                <button type="button" className={styles.recordBtn} onClick={downloadJson}>
                  Download JSON
                </button>

                {/* Saving is the logged-in path; Download JSON above works logged out. */}
                <div style={{ marginTop: '0.75rem' }}>
                  {saveState === 'saved' ? (
                    <p className={styles.exportNote}>
                      Saved to your account.{' '}
                      <Link to="/dashboard">View it in your dashboard.</Link>
                    </p>
                  ) : session ? (
                    <ConsentStep
                      saving={saveState === 'saving'}
                      error={saveError}
                      onSave={(c) => void handleSave(c)}
                    />
                  ) : (
                    <p className={styles.exportNote}>
                      <Link to="/signin">Sign in</Link> to save this recording to your private
                      account. Analysis stays on your device until you do.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className={styles.drawerHint}>
                Record a sustained tone (▶ Start, then ● Record) to capture a 5-second window.
                Results and export will appear here.
              </p>
            )}
          </div>
        </>
      )}
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
