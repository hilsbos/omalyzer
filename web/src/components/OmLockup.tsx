import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import OmMark from './OmMark';
import styles from './OmLockup.module.css';

/**
 * The site lockup: the Om (ॐ) mark + "Omalyzer" wordmark (Fraunces). Runs a quiet
 * fade/bloom intro once, gated on document.fonts.ready and short-circuited by
 * prefers-reduced-motion (handled in CSS). Used in the nav and, at display scale,
 * as the manuscript hero wordmark.
 */
export interface OmLockupProps {
  /** Routes to "/". */
  to?: string;
  /** Run the load inscription once on mount (default true). */
  intro?: boolean;
  /** Extra class on the <a> for sizing (hero scales the wordmark up). */
  className?: string;
  /** aria-label on the link. */
  ariaLabel?: string;
}

export default function OmLockup({
  to = '/',
  intro = true,
  className,
  ariaLabel = 'omalyzer',
}: OmLockupProps) {
  const [introing, setIntroing] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!intro || ranRef.current) return;
    ranRef.current = true;
    const reduce =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) setIntroing(true);
    };
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(start);
    } else {
      start();
    }
    return () => {
      cancelled = true;
    };
  }, [intro]);

  const lockupClass = [styles.lockup, introing ? styles.isIntroing : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Link to={to} className={lockupClass} aria-label={ariaLabel}>
      <OmMark />
      <span className={styles.wordmark} aria-hidden="true">
        omalyzer
      </span>
    </Link>
  );
}
