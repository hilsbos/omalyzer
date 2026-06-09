import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ConsentStep.module.css';

export interface ConsentChoice {
  /** required to save at all */
  store: boolean;
  /** separate opt-in -> oms.consent_share */
  share: boolean;
}

interface Props {
  /** whether a save is currently in flight (disables the button). */
  saving: boolean;
  /** error from the last save attempt, if any. */
  error: string | null;
  onSave: (choice: ConsentChoice) => void;
}

/**
 * Explicit, nothing-pre-checked consent gate shown after a successful record.
 * Two separate checkboxes: storing (required) and community aggregates (opt-in,
 * default off). Honest framing throughout — a within-person acoustic measure,
 * not a diagnosis. No medical/stress/energetic claims.
 */
export default function ConsentStep({ saving, error, onSave }: Props) {
  const [store, setStore] = useState(false);
  const [share, setShare] = useState(false);

  return (
    <div className={styles.card}>
      <p className={styles.intro}>
        Analysis already happened on your device. Saving uploads the audio
        recording plus its acoustic features to your private omalyzer account.
      </p>

      <label className={styles.row}>
        <input
          type="checkbox"
          checked={store}
          onChange={(e) => setStore(e.target.checked)}
        />
        <span>
          <strong>Store this recording.</strong> Save the audio (FLAC) and its
          acoustic features in my private omalyzer account on Supabase. I can
          delete it anytime.
        </span>
      </label>

      <label className={styles.row}>
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>
          <strong>Include my anonymized data in community aggregates.</strong>{' '}
          Add my feature values to corpus-wide distributions and medians. No one
          hears my audio or sees my individual data. (Optional — off by default.)
        </span>
      </label>

      <p className={styles.fine}>
        Voice recordings are sensitive personal data. See our{' '}
        <Link to="/privacy">Privacy</Link> and <Link to="/terms">Terms</Link>.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="button"
        className={styles.saveBtn}
        disabled={!store || saving}
        onClick={() => onSave({ store, share })}
      >
        {saving ? 'Encoding & saving…' : 'Save this om'}
      </button>
      {!store && (
        <span className={styles.hint}>Tick “Store this recording” to enable saving.</span>
      )}
    </div>
  );
}
