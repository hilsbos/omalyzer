import { Link } from 'react-router-dom';
import styles from './prose.module.css';

/**
 * Landing page (/). Copy is the approved paste-ready text, verbatim — written
 * inside the §4.4 honest-framing rules (no medical/stress/chakra/energy claims).
 */
export default function HomePage() {
  return (
    <main className={styles.prose}>
      <h1>Hear the shape of your own voice.</h1>

      <p className={styles.lede}>
        <strong>
          Omalyzer is a real-time vowel- and OM-chant analyzer. Sustain a tone and watch
          your pitch, formants, harmonics, and a Vocal Coherence Index — the steadiness of
          your vocal production — render live in your browser.
        </strong>
      </p>

      <div className={styles.cta}>
        <Link className={styles.ctaPrimary} to="/analyze">
          Try the live analyzer
        </Link>
        <Link className={styles.ctaSecondary} to="/analyze">
          Sign up to contribute your oms
        </Link>
      </div>

      <hr />

      <h2>What it does</h2>
      <p>
        Open the analyzer, allow your mic, and chant a sustained vowel or OM. As you hold
        the note, Omalyzer measures the acoustics of your voice frame by frame:
      </p>
      <ul>
        <li>
          <strong>Pitch (F0)</strong> — the fundamental frequency you're holding, named as
          a musical note, plus how much it drifts and wanders over the held tone.
        </li>
        <li>
          <strong>Formants</strong> — the vocal-tract resonances (F1–F4) that physically
          distinguish one vowel from another, so /a/, /i/, /u/, and OM each produce a
          distinct, measurable profile.
        </li>
        <li>
          <strong>Harmonics &amp; clarity</strong> — the harmonic stack and
          harmonics-to-noise ratio: how clean and orderly the tone is versus how breathy or
          noisy.
        </li>
        <li>
          <strong>Vocal Coherence Index</strong> — a single 0–1 number summarizing how{' '}
          <em>steady</em> your sustained tone is across five acoustic dimensions (pitch
          steadiness, loudness steadiness, harmonic order, spectral stability, and resonance
          sharpness).
        </li>
      </ul>
      <p>Everything is computed live, on your own device, the moment you make a sound.</p>

      <hr />

      <h2>Contribute your oms</h2>
      <p>
        Like a clear readout of your own voice? Sign up and you can save each om you chant —
        the audio plus its measured features — and watch how your sustained tones look over
        time. You choose what to save; nothing is uploaded unless you decide to contribute
        it.
      </p>
      <div className={styles.cta}>
        <Link className={styles.ctaPrimary} to="/analyze">
          Try it now — no account needed
        </Link>
        <Link className={styles.ctaSecondary} to="/analyze">
          Create an account
        </Link>
      </div>

      <hr />

      <blockquote className={styles.callout}>
        Omalyzer measures the acoustics of your voice (pitch, resonance, steadiness). It is
        not a medical, diagnostic, or emotional-state tool, and it does not read stress or
        mood. See the <Link to="/science">science page</Link> for exactly what it does and
        doesn't claim.
      </blockquote>
    </main>
  );
}
