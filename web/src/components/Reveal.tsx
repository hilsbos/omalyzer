import { useEffect, useRef, useState } from 'react';
import styles from '../pages/prose.module.css';

/**
 * Procession reveal for editorial sections: 8px rise + fade once the element
 * scrolls into view (IntersectionObserver → .isVisible). Pages only — never used
 * on the live analyzer. Reduced-motion is handled in CSS (the rise collapses).
 */
export interface RevealProps {
  children: React.ReactNode;
  /** Rendered element tag. */
  as?: 'section' | 'div';
  className?: string;
  /** Stagger delay in ms (60ms-per-child when laddered by the caller). */
  delay?: number;
}

export default function Reveal({ children, as = 'section', className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cls = [styles.reveal, visible ? styles.isVisible : '', className]
    .filter(Boolean)
    .join(' ');
  const style = delay ? { transitionDelay: `${delay}ms` } : undefined;

  const Tag = as;
  return (
    <Tag ref={ref as never} className={cls} style={style}>
      {children}
    </Tag>
  );
}
