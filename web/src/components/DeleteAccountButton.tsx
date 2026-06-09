import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { deleteMyAccount } from '../lib/contributions';

/**
 * Self-serve account deletion (the "right to delete" the Privacy/Terms pages
 * promise). Two-step + type-to-confirm so it can't be triggered accidentally.
 * Purges the user's audio + all DB rows, then signs out and returns home.
 */
export default function DeleteAccountButton() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      await signOut();
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{ color: '#b00020', borderColor: '#b00020', background: 'transparent' }}
      >
        Delete my account
      </button>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '34rem' }}>
      <p>
        This permanently deletes your account, every saved om, and all uploaded
        audio. It cannot be undone. Type <strong>DELETE</strong> to confirm.
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="DELETE"
        aria-label="Type DELETE to confirm account deletion"
        autoComplete="off"
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onDelete}
          disabled={typed !== 'DELETE' || busy}
          style={{ color: '#fff', background: '#b00020', borderColor: '#b00020' }}
        >
          {busy ? 'Deleting…' : 'Permanently delete'}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setTyped('');
            setError(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
    </div>
  );
}
