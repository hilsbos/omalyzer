import { useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from '../pages/DashboardPage.module.css';

/**
 * Lazily mints a short-lived signed URL for a private `oms` object and feeds it
 * to an <audio> element. The bucket is private, so we never expose a public URL.
 */
export default function OmPlayer({ audioPath }: { audioPath: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!audioPath) return <span className={styles.empty}>features-only</span>;

  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio className={styles.audio} controls src={url} />;
  }

  const load = async () => {
    if (!supabase) {
      setError('Could not load audio');
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.storage
      .from('oms')
      .createSignedUrl(audioPath, 60);
    setLoading(false);
    if (e || !data) {
      setError('Could not load audio');
      return;
    }
    setUrl(data.signedUrl);
  };

  return (
    <span>
      <button type="button" className={styles.iconBtn} onClick={() => void load()} disabled={loading}>
        {loading ? 'Loading…' : '▶ Play'}
      </button>
      {error && <span className={styles.error}> {error}</span>}
    </span>
  );
}
