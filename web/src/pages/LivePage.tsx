import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalyzer, type Om } from '../hooks/useAnalyzer';
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

const STORE_MAX_HZ = 4000; // matches core STORE_MAX_HZ

/** A coarse capture-device hint stored as a fidelity covariate (not identifying). */
function deriveDeviceLabel(settings: MediaTrackSettings | null): string | null {
  const isMobile =
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const kind = isMobile ? 'mobile' : 'desktop';
  const label = (settings as { label?: string } | null)?.label;
  return label ? `${kind} · ${label}` : kind;
}

export default function LivePage() {
  const { snapshot, status, start, stop, getHistory, gateDb, setGate, lastOm, clearLastOm } =
    useAnalyzer();
  const { session } = useAuth();
  const [controls, setControls] = useState<DisplayControls>({
    maxFreqHz: 1000,
    dbFloor: -90,
    dbCeil: -30,
  });
  const [tab, setTab] = useState<SecondaryTab>('coherence');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const s: Snapshot | null = snapshot;
  const latestHop = s?.hop_index ?? 0;

  // A fresh om (new completed tone) replaces the prior card — reset its save UI.
  useEffect(() => {
    setSaveState('idle');
    setSaveError(null);
  }, [lastOm?.capturedAt]);

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

  // `live_coherence_index` is non-null precisely while a long-enough tone is
  // mid-hold — the correct "capturing…" signal.
  const capturing = s?.live_coherence_index != null;

  // ── Save the captured om — REAL duration + aligned PCM from `lastOm`. ──────
  const handleSave = useCallback(
    async (choice: ConsentChoice) => {
      if (!lastOm || !lastOm.sampleRate) {
        setSaveError('Nothing captured to save — hold a tone first.');
        return;
      }
      const d = lastOm.snapshot; // the latched completed-tone snapshot
      setSaveState('saving');
      setSaveError(null);
      try {
        const contribution: OmContribution = {
          pcm: lastOm.pcm, // ALIGNED held-tone clip
          sampleRate: lastOm.sampleRate,
          durationSecs: lastOm.durationSecs, // REAL held-tone duration (last_coherence_secs)
          vowel: d.last_coherence_vowel ?? d.vowel ?? null,
          note: d.note ?? null,
          f0Mean: d.detail_mean_f0_hz ?? d.f0 ?? null,
          deviceLabel: deriveDeviceLabel(status.settings),
          micSettings: status.settings,
          consentShare: choice.share,
          coherenceIndex: d.last_coherence_index,
          subMetrics: {
            pitch_coherence: d.pitch_coherence,
            amplitude_coherence: d.amplitude_coherence,
            harmonic_coherence: d.harmonic_coherence,
            spectral_stability: d.spectral_stability,
            resonance_match: d.resonance_match,
          },
          hnrDb: d.detail_hnr_db,
          jitterCents: d.detail_f0_cents_std,
          alphaRatioDb: d.detail_alpha_ratio_db,
          cppsDb: d.detail_cpps_db,
          formants: {
            f1: d.f1,
            f2: d.f2,
            f3: d.f3,
            bandwidth_hz: d.detail_bandwidth_hz,
          },
          rawFeatures: {
            shimmer: d.detail_shimmer,
            rms_cv: d.detail_rms_cv,
            entropy: d.detail_entropy,
            flux: d.detail_flux,
            vowel_conf: d.detail_vowel_conf,
            f0_var_st: d.detail_f0_var_st,
            mean_f0_hz: d.detail_mean_f0_hz,
            captured_at: new Date(lastOm.capturedAt).toISOString(),
            warnings: status.warnings,
          },
        };
        await saveOm(contribution);
        setSaveState('saved');
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        setSaveState('idle');
      }
    },
    [lastOm, status.settings, status.warnings],
  );

  // Export the captured om as JSON (features only; PCM is not serialized).
  const downloadJson = useCallback(() => {
    if (!lastOm) return;
    const d = lastOm.snapshot;
    const capturedAt = new Date(lastOm.capturedAt).toISOString();
    const payload = {
      capturedAt,
      durationSecs: lastOm.durationSecs,
      sampleRate: lastOm.sampleRate,
      vowel: d.last_coherence_vowel ?? d.vowel,
      note: d.note,
      coherenceIndex: d.last_coherence_index,
      subMetrics: {
        pitch_coherence: d.pitch_coherence,
        amplitude_coherence: d.amplitude_coherence,
        harmonic_coherence: d.harmonic_coherence,
        spectral_stability: d.spectral_stability,
        resonance_match: d.resonance_match,
      },
      detail: {
        f0_cents_std: d.detail_f0_cents_std,
        f0_var_st: d.detail_f0_var_st,
        mean_f0_hz: d.detail_mean_f0_hz,
        shimmer: d.detail_shimmer,
        rms_cv: d.detail_rms_cv,
        hnr_db: d.detail_hnr_db,
        entropy: d.detail_entropy,
        flux: d.detail_flux,
        bandwidth_hz: d.detail_bandwidth_hz,
        vowel_conf: d.detail_vowel_conf,
        alpha_ratio_db: d.detail_alpha_ratio_db,
        cpps_db: d.detail_cpps_db,
      },
      formants: { f1: d.f1, f2: d.f2, f3: d.f3 },
      micSettings: status.settings,
      warnings: status.warnings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omalyzer-${capturedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [lastOm, status.settings, status.warnings]);

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
          data-state={capturing ? 'rec' : status.running ? 'live' : 'idle'}
          aria-label={capturing ? 'capturing' : status.running ? 'live' : 'idle'}
        />
        <button
          type="button"
          className={styles.gear}
          aria-label="display and gate"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          ⚙
        </button>
      </header>

      {/* Warnings / errors strip (device + mic status). */}
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

      {/* ── CAPTURED OM — full-width band above the transport (renders only when
          a tone has completed). The thing you just made. ──────────────────── */}
      {lastOm && (
        <CapturedOmCard
          om={lastOm}
          signedIn={session != null}
          saveState={saveState}
          saveError={saveError}
          onSave={(c) => void handleSave(c)}
          onExport={downloadJson}
          onDiscard={clearLastOm}
        />
      )}

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

        {/* live capture hint / capturing state (replaces the old Record button) */}
        {status.running && (
          <span
            className={styles.captureHint}
            data-capturing={capturing}
            aria-live="polite"
          >
            {capturing ? '● capturing…' : 'hold a tone for 2.5 s or more to capture an om'}
          </span>
        )}

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

        <button
          type="button"
          className={styles.drawerToggle}
          aria-label="display and gate"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          Display & gate
        </button>
      </footer>

      {/* ── DRAWER (slide-over) — display + gate controls only ───────────────── */}
      {drawerOpen && (
        <>
          <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className={styles.drawer} role="dialog" aria-label="Display & gate">
            <div className={styles.drawerHead}>
              <span>display &amp; gate</span>
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
          </div>
        </>
      )}
    </div>
  );
}

interface CapturedOmCardProps {
  om: Om;
  signedIn: boolean;
  saveState: 'idle' | 'saving' | 'saved';
  saveError: string | null;
  onSave: (choice: ConsentChoice) => void;
  onExport: () => void;
  onDiscard: () => void;
}

/**
 * The prominent captured-om band, pinned directly above the transport. Renders
 * the tone's acoustic facts (vowel, seconds, coherence index). The save path
 * reuses ConsentStep (the two-checkbox consent gate).
 */
function CapturedOmCard({
  om,
  signedIn,
  saveState,
  saveError,
  onSave,
  onExport,
  onDiscard,
}: CapturedOmCardProps) {
  const d = om.snapshot;
  const idx = d.last_coherence_index;
  const vowel = d.last_coherence_vowel ?? d.vowel ?? '—';
  return (
    <section className={styles.captured} role="region" aria-label="captured om">
      <div className={styles.capturedHead}>
        <strong>om captured</strong>
        <span className={styles.sep}>·</span> /{vowel}/
        <span className={styles.sep}>·</span> {om.durationSecs.toFixed(1)}s
        <span className={styles.sep}>·</span> coherence {idx != null ? idx.toFixed(2) : '—'}
      </div>

      <div className={styles.capturedActions}>
        {saveState === 'saved' ? (
          <span className={styles.savedMsg}>
            saved · <Link to="/dashboard">view in dashboard</Link>
          </span>
        ) : signedIn ? (
          <ConsentStep saving={saveState === 'saving'} error={saveError} onSave={onSave} />
        ) : (
          <span className={styles.signInMsg}>
            <Link to="/signin">sign in to save</Link> — analysis stays on your device. export
            still works.
          </span>
        )}

        <div className={styles.capturedBtns}>
          <button type="button" className={styles.recordBtn} onClick={onExport}>
            export json
          </button>
          <button type="button" className={styles.discardBtn} onClick={onDiscard}>
            discard
          </button>
        </div>
      </div>
    </section>
  );
}
