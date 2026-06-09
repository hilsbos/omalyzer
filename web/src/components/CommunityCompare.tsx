import { useEffect, useState } from 'react';
import { fetchCommunityStats, type CommunityStats, type OmRow } from '../lib/oms';
import styles from '../pages/DashboardPage.module.css';

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(2);

/** Median of a numeric array, or null if empty. */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * "You vs. the community". Your latest + your median against the community
 * median and interquartile band (anonymized aggregates from opt-in contributors,
 * via the community_coherence_stats RPC). Honestly framed: not a ranking or score.
 */
export default function CommunityCompare({ oms }: { oms: OmRow[] }) {
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetchCommunityStats(null)
      .then((s) => live && setStats(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const mine = oms
    .map((o) => o.coherence_index)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const yourLatest = mine.length ? mine[0] : null; // oms are newest-first
  const yourMedian = median(mine);

  return (
    <section className={styles.community}>
      <h2>You vs. the community</h2>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={`${styles.statValue} readout`}>{fmt(yourLatest)}</span>
          <span className={styles.statLabel}>your latest</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} readout`}>{fmt(yourMedian)}</span>
          <span className={styles.statLabel}>your median ({mine.length})</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} readout`}>
            {loading ? '…' : fmt(stats?.median)}
          </span>
          <span className={styles.statLabel}>
            community median{stats ? ` (${stats.n})` : ''}
          </span>
        </div>
      </div>

      {stats && stats.median != null && (
        <div className={styles.bandRow}>
          community interquartile band: {fmt(stats.p25)} – {fmt(stats.p75)}
        </div>
      )}
      {stats && stats.median == null && !loading && (
        <p className={styles.empty}>
          Not enough opted-in contributors yet to show community figures.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.framing}>
        A within-person acoustic steadiness measure. Community figures are
        anonymized aggregates from people who opted in — not a ranking, score, or
        diagnosis.
      </p>
    </section>
  );
}
