import { Link } from 'react-router-dom';
import styles from './prose.module.css';
import OmLockup from '../components/OmLockup';
import Reveal from '../components/Reveal';
import CtaTone from '../components/science/CtaTone';
import HeroTone from '../components/science/HeroTone';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Landing page (/) — one nearly blank sheet of parchment holding one drawn
 * line, one sentence, one button. The hero shows the thesis image (HeroTone:
 * chaos resolving into a clean held tone, synthesized — no microphone here)
 * and sends the one button straight to the studio, where the real instrument
 * lives. Below the fold, three beats — MEASURE → UNDERSTAND → CONTRIBUTE —
 * one CTA each, then the bookend.
 */
export default function HomePage() {
  useDocumentTitle('omalyzer');
  const { user, configured } = useAuth();

  return (
    <main className={styles.prose}>
      <div className={styles.hero}>
        {/* Manuscript hero wordmark — the Om lockup at display scale, runs the
            "the Om is intoned" load inscription once. */}
        <OmLockup to="/" className={styles.heroLockup} ariaLabel="omalyzer" />

        <h1 className={styles.heroTitle}>
          The voice is a window into the nervous system. We&rsquo;re building the map.
        </h1>

        {/* The thesis image: a jittery trace settling into one clean sustained
            tone — and one door to the place where the line becomes yours. */}
        <HeroTone className={styles.setPiece} />
        <div className={styles.cta}>
          <Link className={styles.ctaPrimary} to="/analyze">
            Hold a tone <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </div>
        <p className={styles.bookendLine}>
          The analysis runs entirely in your browser. Nothing leaves your device.
        </p>
      </div>

      <hr />

      {/* ── MEASURE ── */}
      <Reveal>
        <p className={styles.kicker}>Measure</p>
        <h2>One breath is a measurement.</h2>
        <p>
          Hold a tone in the studio and omalyzer reads it as it happens — your pitch, your
          note, the coherence of the hold, computed live from the physics of the sound.
        </p>
        <div className={styles.cta}>
          <Link className={styles.ctaPrimary} to="/analyze">
            Open the studio <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </div>
      </Reveal>

      <hr />

      {/* ── UNDERSTAND ── */}
      <Reveal>
        <p className={styles.kicker}>Understand</p>
        <h2>The line is not a metaphor.</h2>
        <p>
          Every wobble in that trace is physiology — breath support, laryngeal control,
          the slow signature of the autonomic system, written into sound at millisecond
          resolution. We document exactly what we measure, how, and why it matters.
        </p>
        <div className={styles.cta}>
          <Link className={styles.ctaSecondary} to="/science">
            Read the science <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </div>
      </Reveal>

      <hr />

      {/* ── CONTRIBUTE — auth-aware at full prominence; degrades to the studio
            when accounts aren't configured (never a dead /signin) ── */}
      <Reveal>
        <p className={styles.kicker}>Contribute</p>
        {configured && user ? (
          <>
            <h2>Your oms are on the map.</h2>
            <p>
              Every tone you save sharpens your own baseline — and, when you opt in,
              extends the corpus. Hold today&rsquo;s om and keep it.
            </p>
            <div className={styles.cta}>
              <Link className={styles.ctaPrimary} to="/dashboard">
                See your signature <span className={styles.arrow} aria-hidden="true">→</span>
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2>Help us build the map.</h2>
            <p>
              Every om you save and opt to share grows the first open corpus of sustained
              human tone — the baseline atlas a map of the vocal nervous system requires.
              Your recordings stay yours; the patterns belong to everyone.
            </p>
            <div className={styles.cta}>
              {configured ? (
                <Link className={styles.ctaPrimary} to="/signin">
                  Create an account <span className={styles.arrow} aria-hidden="true">→</span>
                </Link>
              ) : (
                <Link className={styles.ctaPrimary} to="/analyze">
                  Save an om in the studio <span className={styles.arrow} aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </>
        )}
      </Reveal>

      <hr />

      {/* ── BOOKEND — the settled tone returned in print, then the last word ── */}
      <Reveal as="div">
        <CtaTone className={styles.setPiece} />
        <p className={styles.bookendLine}>
          The first map of the voice will be drawn from millions of held tones. It begins
          with one.
        </p>
      </Reveal>
    </main>
  );
}
