import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAnalyzer, type Om } from '../hooks/useAnalyzer';
import type { Snapshot } from '../types/snapshot';
import CoherencePanel from '../components/CoherencePanel';
import StateSignals from '../components/StateSignals';
import AdvancedSheet, { type DisplayControls } from '../components/AdvancedSheet';
import TabBar, { type SecondaryTab } from '../components/TabBar';
import ConsentStep, { type ConsentChoice } from '../components/ConsentStep';
import ScoreReveal from '../components/ScoreReveal';
import Spectrogram from '../viz/Spectrogram';
import PitchTrack from '../viz/PitchTrack';
import VowelChart from '../viz/VowelChart';
import { useAuth } from '../auth/AuthProvider';
import { saveOm, type OmContribution } from '../lib/contributions';
import { countMyOmsForVowel } from '../lib/oms';
import { M_HOLDS } from '../components/signature/signatureMath';
import { blinkOpacity, useRafLoop } from '../components/science/motion';
import styles from './LivePage.module.css';

const STORE_MAX_HZ = 4000; // matches core STORE_MAX_HZ

/* ── Practice / console split ────────────────────────────────────────────────
   First-time visitors (often arriving mid-story from the landing hero) get the
   still room: spectrogram, one number, transport. The full console is one
   toggle away and the choice is REMEMBERED — anyone who opens the console
   stays in the console on every return until they close it. The mode is
   purely presentational: useAnalyzer mounts once regardless, so the audio
   lifecycle never notices. */
type AnalyzeView = 'practice' | 'console';
const VIEW_KEY = 'omalyzer.analyze.view';
/** Once any om has ever been captured on this device, the breath cue is
 *  retired permanently — erased by being answered, never a nag. */
const HAS_CAPTURED_KEY = 'omalyzer.analyze.hasCaptured';

function readStoredView(): AnalyzeView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'console' ? 'console' : 'practice';
  } catch {
    return 'practice'; // storage unavailable (private mode) → first-time default
  }
}
function readHasCaptured(): boolean {
  try {
    return localStorage.getItem(HAS_CAPTURED_KEY) === '1';
  } catch {
    return false;
  }
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
  /* The dialog convention cuts both ways: focus moves INTO the drawer on
     open (the close button's autoFocus) and must come BACK to whichever
     button opened it on close — otherwise Escape strands focus on <body>.
     Two triggers can open it (the appbar gear, the console's transport
     toggle), so the ref records the one actually used. */
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toggleDrawer = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    drawerTriggerRef.current = e.currentTarget;
    setDrawerOpen((o) => !o);
  }, []);
  useEffect(() => {
    if (!drawerOpen && drawerTriggerRef.current) {
      drawerTriggerRef.current.focus();
      drawerTriggerRef.current = null;
    }
  }, [drawerOpen]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  /* The saved line's signature fact ("/a/ — 7 of ~12"): one RLS-scoped count,
     fetched fire-and-forget AFTER the save the user already chose (never an
     incentive inside the consent gate). Keyed to the capture it belongs to so
     a slow response can never label a different om; on null the line falls
     back to the bare "view your signature" link. */
  const [savedFact, setSavedFact] = useState<{ at: number; vowel: string; count: number } | null>(
    null,
  );

  // Practice/console view — lazy init from localStorage, written on toggle.
  const [view, setView] = useState<AnalyzeView>(readStoredView);
  const toggleView = useCallback(() => {
    setView((v) => {
      const next: AnalyzeView = v === 'practice' ? 'console' : 'practice';
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        /* private mode — the toggle still works for this visit */
      }
      return next;
    });
  }, []);
  const [hasCaptured, setHasCaptured] = useState(readHasCaptured);

  const s: Snapshot | null = snapshot;
  const latestHop = s?.hop_index ?? 0;

  // A fresh om (new completed tone) replaces the prior card — reset its save
  // UI, and permanently retire the breath cue (answered, not dismissed).
  useEffect(() => {
    setSaveState('idle');
    setSaveError(null);
    setSavedFact(null);
    if (lastOm != null) {
      setHasCaptured(true);
      try {
        localStorage.setItem(HAS_CAPTURED_KEY, '1');
      } catch {
        /* private mode — session-scoped retirement still holds */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOm?.capturedAt]);

  // Ceremony beat per capture: the session's FIRST om earns the full 3.2 s
  // braid; every om after plays the same gesture compressed (~1.8 s) — kinder
  // to a practitioner chaining oms. Render-time ref bump is idempotent
  // (StrictMode-safe): same capturedAt → no increment.
  const ceremonyRef = useRef<{ seenAt: number; count: number }>({ seenAt: 0, count: 0 });
  if (lastOm && lastOm.capturedAt !== ceremonyRef.current.seenAt) {
    ceremonyRef.current = { seenAt: lastOm.capturedAt, count: ceremonyRef.current.count + 1 };
  }
  const revealCompressed = ceremonyRef.current.count > 1;

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
        // The signature tie-in: count this sound's holds (own rows only,
        // head-only). Fire-and-forget — the saved line renders immediately
        // and gains the fact if/when the count lands for THIS capture.
        const v = d.last_coherence_vowel ?? d.vowel ?? null;
        if (v) {
          const at = lastOm.capturedAt;
          void countMyOmsForVowel(v).then((n) => {
            if (n != null && n > 0) setSavedFact({ at, vowel: v, count: n });
          });
        }
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
    <main
      className={`${styles.console} instrument`}
      data-running={status.running}
      data-view={view}
      data-captured={lastOm != null}
    >
      {/* page title for assistive tech — the visible header is the wordmark link */}
      <h1 className={styles.srOnly}>omalyzer studio — live vowel-chant analyzer</h1>

      {/* ── APP BAR ─────────────────────────────────────────────────────────── */}
      <header className={styles.appbar}>
        <Link to="/" className={styles.brand} aria-label="omalyzer home">
          <span className={styles.om}>ॐ</span>
          <span className={styles.wordmark}>omalyzer</span>
          <span className={styles.liveTag}>· LIVE</span>
        </Link>
        <span className={styles.appbarSpacer} />
        {view === 'console' && (
          <>
            <span className={styles.device}>
              {status.sampleRate ? `${(status.sampleRate / 1000).toFixed(0)} kHz` : '— kHz'}
            </span>
            <span className={styles.sep}>·</span>
            <span className={styles.device}>{deriveDeviceLabel(status.settings) ?? 'Mic'}</span>
          </>
        )}
        <span
          className={styles.statusDot}
          data-state={capturing ? 'rec' : status.running ? 'live' : 'idle'}
          aria-label={capturing ? 'capturing' : status.running ? 'live' : 'idle'}
        />
        {/* The door between the two rooms — same position from either side.
            No aria-pressed: a state-changing label + pressed-state is a mixed
            signal ("close the console, pressed") — the two honest command
            labels carry the state by themselves. */}
        <button type="button" className={styles.viewToggle} onClick={toggleView}>
          {view === 'practice' ? 'open the console' : 'close the console'}
        </button>
        {/* The gear stays in BOTH modes: the gate slider is the one DSP
            control a beginner in a noisy room genuinely needs. */}
        <button
          type="button"
          className={styles.gear}
          aria-label="display and gate"
          aria-expanded={drawerOpen}
          onClick={toggleDrawer}
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

      {/* ── PRACTICE FOCUS — the one number, where the cockpit would be ──────
          While a tone is held: the live index, breathing hop-by-hop (the
          number IS the during-hold affordance). After a capture: the last
          index, at rest. Before anything: the breath cue (until the first om
          ever captured on this device answers it) or an em-dash. */}
      {view === 'practice' && (
        <section className={styles.focus} aria-label="coherence">
          <span className={styles.focusLabel}>coherence</span>
          {s?.live_coherence_index != null ? (
            <span className={styles.focusValue} data-state="live">
              {s.live_coherence_index.toFixed(2)}
            </span>
          ) : s?.last_coherence_index != null ? (
            <span className={styles.focusValue} data-state="rest">
              {s.last_coherence_index.toFixed(2)}
            </span>
          ) : status.running && !hasCaptured && !s?.voiced ? (
            /* displaced the moment a tone crosses the gate (voiced), not 2.5 s
               later when the live index first exists — while the first-ever
               tone builds toward its index, the number's seat sits empty */
            <span className={styles.focusValue} data-state="cue">
              <BreathCue />
            </span>
          ) : (
            <span className={styles.focusValue} data-state="empty">
              —
            </span>
          )}
        </section>
      )}

      {/* ── CONSOLE-ONLY CELLS — unmounted in practice (purely presentational:
          useAnalyzer runs regardless; pitch/vowel rebuild from getHistory()'s
          ring on remount). ─────────────────────────────────────────────────── */}
      {view === 'console' && (
        <>
          {/* ── RIGHT RAIL — coherence dial + sub-metrics + measured│inferred ── */}
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

          {/* ── PITCH — col 1, lower row ─────────────────────────────────────── */}
          <section className={`${styles.cell} ${styles.pitch}`} data-active={tab === 'pitch'}>
            <div className={styles.cellHead}>∿ pitch track · F0 over time</div>
            <div className={styles.cellBody}>
              <PitchTrack getHistory={getHistory} latestHop={latestHop} />
            </div>
          </section>

          {/* ── VOWEL — col 2, lower row ─────────────────────────────────────── */}
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
        </>
      )}

      {/* Persistent visually-hidden status (persistent sr-only status idiom): mounted
          from the first render so the capture is ANNOUNCED — a live region
          inserted with the band would stay silent, and the transport hint
          flips back to the instruction on completion, so without this an SR
          user never hears the index. */}
      <p className={styles.srOnly} role="status">
        {lastOm
          ? `om captured — coherence index ${
              lastOm.snapshot.last_coherence_index?.toFixed(2) ?? 'unavailable'
            }, sustained /${lastOm.snapshot.last_coherence_vowel ?? lastOm.snapshot.vowel ?? '—'}/, ${lastOm.durationSecs.toFixed(1)} seconds`
          : ''}
      </p>

      {/* ── CAPTURED OM — full-width band above the transport (renders only when
          a tone has completed). The thing you just made. ──────────────────── */}
      {lastOm && (
        <CapturedOmCard
          om={lastOm}
          revealCompressed={revealCompressed}
          signedIn={session != null}
          saveState={saveState}
          saveError={saveError}
          savedFact={savedFact && savedFact.at === lastOm.capturedAt ? savedFact : null}
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

        {/* Console-only transport detail — practice keeps the thin sill:
            Start/Stop, the factual capture hint, and the clock. */}
        {view === 'console' && (
          <>
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
          </>
        )}

        <span className={styles.transportSpacer} />

        {view === 'console' && (
          <button
            type="button"
            className={styles.drawerToggle}
            aria-label="display and gate"
            aria-expanded={drawerOpen}
            onClick={toggleDrawer}
          >
            Display & gate
          </button>
        )}
      </footer>

      {/* ── DRAWER (slide-over) — display + gate controls only ───────────────── */}
      {drawerOpen && (
        <>
          <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden />
          {/* Initial focus moves to the close button (the dialog convention;
              previously focus stayed on the trigger behind the scrim), Escape
              closes, and on close focus returns to the opening button (the
              drawerTriggerRef effect above) — still no trap: every control
              stays a real tabbable element. */}
          <div
            className={styles.drawer}
            role="dialog"
            aria-label="Display & gate"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDrawerOpen(false);
            }}
          >
            <div className={styles.drawerHead}>
              <span>display &amp; gate</span>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setDrawerOpen(false)}
                aria-label="close"
                autoFocus
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
    </main>
  );
}

interface CapturedOmCardProps {
  om: Om;
  /** False for the session's first capture (full 3.2 s braid), true after
   *  (same gesture at 9/16 time). */
  revealCompressed: boolean;
  signedIn: boolean;
  saveState: 'idle' | 'saving' | 'saved';
  saveError: string | null;
  /** RLS-scoped holds-count for the saved om's sound, or null while/if
   *  unavailable — the saved line then carries the arc in its link alone. */
  savedFact: { vowel: string; count: number } | null;
  onSave: (choice: ConsentChoice) => void;
  onExport: () => void;
  onDiscard: () => void;
}

/**
 * The prominent captured-om band, pinned directly above the transport. The
 * braid reckoning (ScoreReveal) composes INSIDE the band — the earned number
 * and the save decision are physically one object; no overlay, no dismissal,
 * input never blocked. key={om.capturedAt} remounts the reveal per capture so
 * every om gets a fresh t=0 beat. The head prints the facts (vowel, seconds);
 * the braid readout is the index of record — printed once. The save path
 * reuses ConsentStep (the two-checkbox consent gate).
 */
function CapturedOmCard({
  om,
  revealCompressed,
  signedIn,
  saveState,
  saveError,
  savedFact,
  onSave,
  onExport,
  onDiscard,
}: CapturedOmCardProps) {
  const d = om.snapshot;
  const idx = d.last_coherence_index;
  const vowel = d.last_coherence_vowel ?? d.vowel ?? '—';
  return (
    // tabIndex=0: the band is a capped scroll region (tall save flow scrolls
    // internally instead of clipping under the fixed console) — the WAI
    // scrollable-region pattern (role + label + tabindex) keeps it
    // arrow-key-scrollable in every browser.
    <section className={styles.captured} role="region" aria-label="captured om" tabIndex={0}>
      {idx != null && (
        <ScoreReveal
          key={om.capturedAt}
          className={styles.capturedReveal}
          metrics={{
            pitch: d.pitch_coherence,
            amplitude: d.amplitude_coherence,
            harmonic: d.harmonic_coherence,
            spectral: d.spectral_stability,
            resonance: d.resonance_match,
          }}
          index={idx}
          vowel={d.last_coherence_vowel ?? d.vowel ?? null}
          seconds={om.durationSecs}
          compressed={revealCompressed}
        />
      )}

      <div className={styles.capturedRow}>
        <div className={styles.capturedHead}>
          <strong>om captured</strong>
          <span className={styles.sep}>·</span> /{vowel}/
          <span className={styles.sep}>·</span> {om.durationSecs.toFixed(1)}s
          {/* the index prints in the braid readout above; repeat it here only
              if there is no reveal to carry it */}
          {idx == null && (
            <>
              <span className={styles.sep}>·</span> coherence —
            </>
          )}
        </div>

        <div className={styles.capturedActions}>
          {/* Persistent visually-hidden status (the same idiom as the capture
              announcer above): mounted with the card — BEFORE any save — so
              when ConsentStep unmounts and takes focus with it, "saved" is
              still announced, and the signature fact that lands a beat later
              re-announces through the same region. */}
          <span className={styles.srOnly} role="status">
            {saveState === 'saved'
              ? `saved${
                  savedFact
                    ? savedFact.count < M_HOLDS
                      ? ` — /${savedFact.vowel}/, ${savedFact.count} of about ${M_HOLDS} holds`
                      : ` — /${savedFact.vowel}/, ${savedFact.count} held, sharpening`
                    : ''
                } — view your signature on your dashboard`
              : ''}
          </span>
          {saveState === 'saved' ? (
            <span className={styles.savedMsg}>
              {/* the arc, printed as fact: below ~12 the count counts toward
                  the band; at/past it the counter retires into "sharpening".
                  No fact (slow count / unclassified vowel) → the link alone
                  carries it. */}
              saved ·{' '}
              {savedFact &&
                (savedFact.count < M_HOLDS
                  ? `/${savedFact.vowel}/ — ${savedFact.count} of ~${M_HOLDS} · `
                  : `/${savedFact.vowel}/ — ${savedFact.count} held · sharpening · `)}
              <Link to="/dashboard">view your signature</Link>
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
      </div>
    </section>
  );
}

/**
 * One line, self-erasing: the pre-first-tone affordance in the practice focus
 * band, with the house cursor-block blinking on the ~3 s listening period
 * (the sr-only status idiom). It is displaced by the live index the moment a
 * tone crosses the gate, and retired permanently once any om has been
 * captured on this device — erased by being answered, never dismissed. Under
 * reduced motion the loop never ticks and the cursor parks at 0.6 opacity.
 */
function BreathCue() {
  const ref = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  useRafLoop(ref, (t) => {
    cursorRef.current?.style.setProperty('opacity', blinkOpacity(t % 3, 2.0, 0.6).toFixed(3));
  });
  return (
    <span ref={ref} className={styles.breathCue}>
      one breath in · then one long, easy tone
      <span ref={cursorRef} className={styles.cueCursor} aria-hidden="true" />
    </span>
  );
}
