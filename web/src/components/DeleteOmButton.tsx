import { useState } from 'react';
import { deleteOm } from '../lib/contributions';
import styles from '../pages/DashboardPage.module.css';

interface Props {
  id: string;
  audioPath: string | null;
  /** called after a successful delete so the list can drop the row optimistically. */
  onDeleted: (id: string) => void;
}

/**
 * Permanently deletes an om: the row (om_features removed via ON DELETE CASCADE)
 * plus its Storage object. Confirms first; real, complete deletion.
 */
export default function DeleteOmButton({ id, audioPath, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!window.confirm('Permanently delete this recording and its features? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteOm(id, audioPath);
      onDeleted(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" className={styles.deleteBtn} onClick={() => void onClick()} disabled={busy}>
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error && <span className={styles.error}> {error}</span>}
    </span>
  );
}
