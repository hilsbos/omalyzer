import { Link } from 'react-router-dom';
import styles from './prose.module.css';

/**
 * Privacy page (/privacy). Honest framing throughout: Omalyzer reports acoustic
 * steadiness — no medical, stress, lie-detection, or energetic claims anywhere.
 */
export default function PrivacyPage() {
  return (
    <main className={styles.prose}>
      <h1>Privacy</h1>
      <p className={styles.lede}>
        Omalyzer analyzes your voice on your own device. Nothing leaves your
        browser unless you explicitly choose to save a recording.
      </p>

      <hr />

      <h2>Local by default</h2>
      <p>
        All audio analysis runs in your browser via WebAssembly. The microphone
        stream is processed on your device; no audio is uploaded as you analyze.
        Uploading only happens when you press <strong>Save</strong> on a recording
        and tick the consent box.
      </p>

      <h2>What we store, only with your consent</h2>
      <p>When you save an om, we store, in your private account:</p>
      <ul>
        <li>The audio recording, encoded as a FLAC file, in private Supabase Storage.</li>
        <li>
          Its acoustic features: fundamental frequency, formants,
          harmonics-to-noise ratio, the coherence index and its sub-metrics,
          jitter, alpha ratio, cepstral peak prominence, and related values.
        </li>
        <li>
          Capture metadata: sample rate, your microphone settings (a fidelity
          covariate), and a coarse device type (mobile or desktop).
        </li>
      </ul>

      <h2>Voice is biometric data</h2>
      <p>
        A voice recording can identify you, so we treat saved audio as sensitive
        personal data. It is private to your account, secured by row-level access
        rules, and is <strong>never</strong> played to other users.
      </p>

      <h2>Community aggregates (opt-in, separate)</h2>
      <p>
        Only if you separately tick “include my anonymized data in community
        aggregates” do your feature values feed into corpus-wide statistics
        (medians and quartiles). These are aggregates only — no one accesses your
        individual data or audio, and a small-sample floor suppresses figures that
        could single anyone out. You can turn this off and delete your data at any
        time.
      </p>

      <h2>Your right to delete</h2>
      <p>
        From your <Link to="/dashboard">dashboard</Link> you can permanently delete
        any om; this removes both the database rows and the stored audio file.
        Deleting your account removes everything associated with it.
      </p>

      <h2>What this is not</h2>
      <p>
        Omalyzer reports the acoustic steadiness of your voice. It is{' '}
        <strong>not</strong> a medical, psychological, stress, or energetic
        assessment, and nothing here is a diagnosis.
      </p>

      <h2>Storage &amp; access</h2>
      <p>
        Data is hosted on Supabase. Row-level security restricts every record to
        its owner. For data requests, contact{' '}
        <a href="mailto:patrick@hilsbos.com">patrick@hilsbos.com</a>.
      </p>

      <p className={styles.tag}>
        See also our <Link to="/terms">Terms of Service</Link>.
      </p>
    </main>
  );
}
