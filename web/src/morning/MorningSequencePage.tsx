/* ── MorningSequencePage — the standalone /morning route screen ─────────────
   The one-tap guided full-vowel scan, given a body. A pure-frontend route
   (sibling of /analyze, NOT under SiteLayout) that paints uniformly dark from
   the first frame via a scoped token-remap wrapper — the LivePage `.console`
   idiom — so every reused parchment component (OmLockup, SettlingLine,
   ScoreReveal) reads correctly on dark with no per-component edits. One page,
   one atmosphere, never a scroll-driven light→dark shift.

   This component owns the single useMorningSequence() instance (which in turn
   owns the single useAnalyzer) and switches on controller.phase:

     idle    → the calm title card: OmLockup, the opening invitation, any quiet
               mic-routing heads-up, and the big Begin button. Begin's onClick
               IS the user gesture that calls start() exactly once.
     error   → a calm retry: the Begin button again (start() is idempotent).
     scanning|revealing → VowelStep for the current vowel (the live hold, the
               5-dot rail, and — during 'revealing' — the in-place ScoreReveal).
     summary → MorningSummary: the five-vowel rollup + opt-in save + restart.

   Holds NO analyzer/save logic of its own — the hook drives the machine and
   MorningSummary owns persistence. The Rust core / WASM bindings are untouched. */

import { useMorningSequence } from './useMorningSequence';
import VowelStep from './VowelStep';
import MorningSummary from './MorningSummary';
import MorningButton from './MorningButton';
import { MORNING_OPENING_COPY, MORNING_SCRIPT } from './vowelScript';
import OmLockup from '../components/OmLockup';
import { Link } from 'react-router-dom';
import styles from './MorningSequencePage.module.css';

/** A quiet, human announcer line for the visually-hidden role=status region —
 *  keeps the flow legible to assistive tech without ever leaking the live
 *  coherence number. */
function announce(
  phase: ReturnType<typeof useMorningSequence>['phase'],
  stepLabel: string | null,
  stepIndex: number,
  total: number,
): string {
  switch (phase) {
    case 'idle':
      return 'Ready. Press Begin to start the morning vowel scan.';
    case 'scanning':
      return stepLabel ? `Hold ${stepLabel}. Vowel ${stepIndex + 1} of ${total}.` : '';
    case 'revealing':
      return stepLabel ? `${stepLabel} captured. Vowel ${stepIndex + 1} of ${total}.` : '';
    case 'summary':
      return 'Scan complete. Your signature this morning is ready.';
    case 'error':
      return 'The scan could not start. Check the message on screen, then press Begin to try again.';
    default:
      return '';
  }
}

export default function MorningSequencePage() {
  const m = useMorningSequence();
  const {
    phase,
    stepIndex,
    total,
    current,
    results,
    snapshot,
    status,
    revealResult,
    begin,
    onRevealDone,
    skipCurrent,
    restart,
  } = m;

  const isLive = phase === 'scanning' || phase === 'revealing';

  return (
    <div className={styles.screen}>
      {/* a persistent, up-front announcer — the flow narrated for AT, never the
          live number */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce(phase, current?.label ?? null, stepIndex, total)}
      </p>

      <header className={styles.bar}>
        <OmLockup intro={false} />
        <Link to="/" className={styles.home}>
          home
        </Link>
      </header>

      <main className={styles.stage}>
        {phase === 'idle' && (
          <div className={styles.card}>
            <p className={styles.opening}>{MORNING_OPENING_COPY}</p>

            {/* a quiet preview of the glide ahead — the five vowels in order,
                so the scan reads as a known ritual, not a mystery button */}
            <div className={styles.intro}>
              <div className={styles.preview} aria-hidden="true">
                {MORNING_SCRIPT.map((v, i) => (
                  <span key={v.key} className={styles.previewVowel}>
                    {i > 0 && <span className={styles.previewGlide}>→</span>}
                    {v.label}
                  </span>
                ))}
              </div>
              <p className={styles.meta}>five breaths · about a minute</p>
            </div>

            {status.warnings.length > 0 && (
              <ul className={styles.warnings}>
                <li className={styles.warningsLead}>
                  A quick note before you begin — the vowel map reads best on a wired or built-in
                  mic with processing off:
                </li>
                {status.warnings.map((w) => (
                  <li key={w} className={styles.warning}>
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <MorningButton onClick={begin} variant="primary" label="Begin" />
          </div>
        )}

        {phase === 'error' && (
          <div className={styles.card}>
            {/* Lead with the analyzer's own diagnosis — its status.error already
                carries the right guidance (open in Safari, check the connection,
                free the mic). Only a true permission wait gets the permission
                framing; blaming permission for every failure sends webview and
                network users chasing a prompt that will never come. */}
            {status.errorKind === 'permission' || !status.error ? (
              <>
                <p className={styles.errorLead}>
                  The microphone is waiting on your permission. Grant it and we will pick up right
                  here.
                </p>
                {status.error && <p className={styles.errorDetail}>{status.error}</p>}
              </>
            ) : (
              <p className={styles.errorLead}>{status.error}</p>
            )}
            <MorningButton onClick={begin} variant="primary" label="Begin" />
          </div>
        )}

        {isLive && current && (
          <VowelStep
            item={current}
            stepIndex={stepIndex}
            total={total}
            results={results}
            snapshot={snapshot}
            running={phase === 'scanning'}
            revealResult={revealResult}
            compressed={stepIndex > 0}
            onRevealDone={onRevealDone}
            onSkip={skipCurrent}
          />
        )}

        {phase === 'summary' && <MorningSummary results={results} onRestart={restart} />}
      </main>
    </div>
  );
}
