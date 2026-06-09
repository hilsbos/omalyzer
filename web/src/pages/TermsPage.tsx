import { Link } from 'react-router-dom';
import styles from './prose.module.css';
import Reveal from '../components/Reveal';

/** Small-caps section label with a leading italic roman numeral. */
function Label({ roman, children }: { roman: string; children: React.ReactNode }) {
  return (
    <div className="section-label">
      <span className="roman">{roman}</span>
      {children}
    </div>
  );
}

/**
 * Terms of Service (/terms). Honest framing: a wellness/exploration tool that
 * measures within-person acoustics — explicitly not a medical device and not a
 * diagnosis. No stress/lie-detection/energetic claims.
 */
export default function TermsPage() {
  return (
    <main className={styles.prose}>
      <h1>Terms of Service</h1>
      <p className={styles.lede}>
        Plain-language terms for using Omalyzer. By using the app you agree to
        these.
      </p>

      <hr />

      <Reveal>
      <Label roman="I">what Omalyzer is</Label>
      <h2>What Omalyzer is</h2>
      <p>
        Omalyzer is a tool for measuring within-person acoustic properties of
        vowel chanting — pitch, formants, harmonics-to-noise ratio, and a
        coherence index that tracks the steadiness of a sustained tone. It is a
        wellness and exploration tool. It is <strong>not</strong> a medical device,
        and it provides no diagnosis or health advice.
      </p>
      </Reveal>

      <Reveal>
      <Label roman="II">your account &amp; content</Label>
      <h2>Your account &amp; content</h2>
      <p>
        You own your recordings. By saving them, you grant Omalyzer the limited
        right to store and process them solely to provide the service — and, only
        if you opt in, to include anonymized aggregate statistics. We do not sell
        your data or play your audio to others.
      </p>
      </Reveal>

      <Reveal>
      <Label roman="III">acceptable use</Label>
      <h2>Acceptable use</h2>
      <p>
        Record only your own voice, or voices you have permission to record. Do
        not use Omalyzer for any unlawful or harmful purpose.
      </p>
      </Reveal>

      <Reveal>
      <Label roman="IV">no warranty</Label>
      <h2>No warranty</h2>
      <p>
        Measurements depend on microphone fidelity. Mobile devices in particular
        may apply processing (automatic gain, noise suppression) you cannot fully
        disable, which the app flags as capture warnings. Accuracy is not
        guaranteed, and the app is provided “as is” without warranties.
      </p>
      </Reveal>

      <Reveal>
      <Label roman="V">deletion &amp; termination</Label>
      <h2>Deletion &amp; termination</h2>
      <p>
        You may delete any recording, or your entire account, at any time from
        your <Link to="/dashboard">dashboard</Link>. Deletion removes the stored
        rows and audio. We may suspend access for misuse.
      </p>
      </Reveal>

      <Reveal>
      <Label roman="VI">changes &amp; contact</Label>
      <h2>Changes &amp; contact</h2>
      <p>
        We may update these terms; material changes will be reflected here.
        Questions: <a href="mailto:patrick@hilsbos.com">patrick@hilsbos.com</a>.
      </p>
      </Reveal>

      <p className={styles.tag}>
        See also our <Link to="/privacy">Privacy</Link> page.
      </p>
    </main>
  );
}
