import type { CommunityStats, OmRow } from '../lib/oms';
import { median } from '../lib/stats';
import styles from '../pages/DashboardPage.module.css';

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(2);

interface CommunityCompareProps {
  oms: OmRow[];
  /** The parent's fetchCommunityStats(null) result — one fetch feeds both
   *  this panel and the signature plate's dashed community tick. */
  stats: CommunityStats | null;
  loading: boolean;
  error: string | null;
}

/**
 * "Against the whole". Your latest + your median against the community
 * median and interquartile band (anonymized aggregates from opt-in contributors,
 * via the community_coherence_stats RPC — fetched once by the dashboard).
 */
export default function CommunityCompare({ oms, stats, loading, error }: CommunityCompareProps) {
  const mine = oms
    .map((o) => o.coherence_index)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const yourLatest = mine.length ? mine[0] : null; // oms are newest-first
  const yourMedian = median(mine);

  return (
    <section className={styles.community}>
      <h2>Against the whole</h2>
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
          Community figures print as contributors opt in — the corpus is forming.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.framing}>
        Your coherence against the corpus. Community figures are anonymized
        aggregates from people who opted in — no one's raw voice is ever exposed.
      </p>
    </section>
  );
}
