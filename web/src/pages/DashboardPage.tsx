import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchMyOms, type OmRow } from '../lib/oms';
import OmPlayer from '../components/OmPlayer';
import DeleteOmButton from '../components/DeleteOmButton';
import CommunityCompare from '../components/CommunityCompare';
import DeleteAccountButton from '../components/DeleteAccountButton';
import styles from './DashboardPage.module.css';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtCoh = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const fmtDur = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}s`);

export default function DashboardPage() {
  const { user } = useAuth();
  const [oms, setOms] = useState<OmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyOms()
      .then((rows) => live && setOms(rows))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const onDeleted = useCallback((id: string) => {
    setOms((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return (
    <main className={`${styles.page} instrument`}>
      <h1>Your oms</h1>
      <p className={styles.sub}>
        Signed in as <strong>{user?.email}</strong>.
      </p>

      <p className={styles.framing}>
        These are your own saved recordings and their acoustic features. The
        coherence index is a within-person measure of vocal steadiness — not a
        diagnosis, score, or health assessment. Your audio is private to your
        account and is never played to anyone else.
      </p>

      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : oms.length === 0 ? (
        <p className={styles.empty}>
          No saved oms yet. Record a tone on the Analyze page and save it.
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vowel</th>
              <th>Coherence</th>
              <th>Duration</th>
              <th>Audio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {oms.map((o) => (
              <tr key={o.id}>
                <td>{fmtDate(o.created_at)}</td>
                <td>{o.vowel ?? '—'}</td>
                <td className="readout">{fmtCoh(o.coherence_index)}</td>
                <td className="readout">{fmtDur(o.duration_secs)}</td>
                <td>
                  <OmPlayer audioPath={o.audio_path} />
                </td>
                <td>
                  <DeleteOmButton id={o.id} audioPath={o.audio_path} onDeleted={onDeleted} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CommunityCompare oms={oms} />

      <section style={{ marginTop: '3rem', borderTop: '1px solid var(--rule)', paddingTop: '1.5rem' }}>
        <h2>Account</h2>
        <p className={styles.framing}>
          You can permanently delete your account and all associated data —
          every saved om, its features, and all uploaded audio — at any time.
          This is immediate and cannot be undone.
        </p>
        <DeleteAccountButton />
      </section>
    </main>
  );
}
