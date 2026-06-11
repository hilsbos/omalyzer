import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchCommunityStats,
  fetchMyOms,
  type CommunityStats,
  type OmRow,
} from '../lib/oms';
import OmPlayer from '../components/OmPlayer';
import DeleteOmButton from '../components/DeleteOmButton';
import CommunityCompare from '../components/CommunityCompare';
import DeleteAccountButton from '../components/DeleteAccountButton';
import SignaturePlate from '../components/signature/SignaturePlate';
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

/**
 * The home of the signature. The plate (SignaturePlate) draws the forming
 * Vocal Resonance Signature from the same RLS-scoped rows the ledger lists;
 * one community fetch feeds both the "Against the whole" panel and the
 * plate's dashed community tick. Deleting a row recomputes the plate
 * statically (no replay) — one state array feeds everything.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const [oms, setOms] = useState<OmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Community aggregates — fetched once here (dashboard is auth-gated, so the
  // authenticated-only RPC never 42501s); errors stay inside the panel and the
  // plate simply draws no community tick.
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyOms()
      .then((rows) => live && setOms(rows))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    fetchCommunityStats(null)
      .then((s) => live && setStats(s))
      .catch((e) => live && setStatsError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setStatsLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const onDeleted = useCallback((id: string) => {
    setOms((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return (
    <main className={`${styles.page} instrument`}>
      <h1>Your signature</h1>
      <p className={styles.sub}>
        Signed in as <strong>{user?.email}</strong>.
      </p>

      <p className={styles.framing}>
        Every om you save strikes one mark here — a hold&rsquo;s coherence, inked on its
        sound&rsquo;s line. Mark by mark, the distributions take shape: your Vocal Resonance
        Signature, sharpening for as long as you keep holding. Your audio stays private to
        your account; only features you opted to share ever reach the corpus.
      </p>

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <SignaturePlate oms={oms} loading={loading} community={stats} />
      )}

      <CommunityCompare oms={oms} stats={stats} loading={statsLoading} error={statsError} />

      <section className={styles.ledger}>
        <h2>Your oms</h2>
        {loading ? (
          <p className={styles.loading}>Loading…</p>
        ) : error ? null : oms.length === 0 ? (
          <p className={styles.empty}>
            Your saved oms will land here — dated, replayable, yours alone. Hold one in the
            still room.
          </p>
        ) : (
          /* the table keeps its natural column widths; on narrow viewports it
             scrolls inside this wrapper instead of dragging the page wide */
          <div className={styles.tableScroll}>
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
          </div>
        )}
      </section>

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
