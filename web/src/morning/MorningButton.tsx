/* ── morning/MorningButton — the one-tap entry into the Morning Sequence ─────
   Push-button-easy: the single calm affordance that opens (or begins) the
   guided full-vowel scan. Two shapes, one component:

     • As a navigation Link (no onClick) — the discoverability entry points
       scattered across the parchment site (the /analyze on-ramp, the HomePage
       CTA, the nav). Defaults to `to="/morning"`.
     • As a real <button> (onClick given) — the in-flow Begin/retry inside
       MorningSequencePage. THAT click is the user gesture that calls start()
       (ctx.resume + getUserMedia are gesture-gated), so this path must stay a
       genuine button, never an auto-fired Link.

   Three calm visual registers via `variant`:
     • 'primary'   — the in-flow Begin, plate tokens (dark measuring ground).
     • 'on-ramp'   — the large centred tap-target beside LivePage's begin.
     • 'secondary' — the quiet outlined CTA next to the parchment /analyze link.

   Pure presentational: no analyzer access, no logic beyond rendering. Brand
   discipline — lowercase 'omalyzer', IBM Plex Mono via tokens, the ॐ ONLY
   through OmMark (Tiro Devanagari). No animation, no Math.random. */

import { Link } from 'react-router-dom';
import OmMark from '../components/OmMark';
import styles from './MorningButton.module.css';

export interface MorningButtonProps {
  /** When given, render a real <button> and call this on the user gesture —
   *  the start() path. Takes precedence over `to`. */
  onClick?: () => void | Promise<void>;
  /** Navigation target when there is no onClick (defaults to '/morning'). */
  to?: string;
  /** The visible call to action (defaults to a calm 'morning scan' / 'begin'). */
  label?: string;
  /** Visual register — see module header. */
  variant?: 'primary' | 'on-ramp' | 'secondary';
  /** Disables the button form (no effect on the Link form). */
  disabled?: boolean;
  /** Extra class hook for the host context. */
  className?: string;
}

/** Sensible default labels per variant — lowercase, forward-looking, calm. */
const DEFAULT_LABEL: Record<NonNullable<MorningButtonProps['variant']>, string> = {
  primary: 'begin',
  'on-ramp': 'morning scan',
  secondary: 'morning scan',
};

export default function MorningButton({
  onClick,
  to,
  label,
  variant = 'primary',
  disabled = false,
  className,
}: MorningButtonProps) {
  const text = label ?? DEFAULT_LABEL[variant];
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(' ');

  /* The inner mark + label is shared by both shapes so they read identically.
     OmMark inherits currentColor, so it themes with the surrounding register. */
  const inner = (
    <>
      <OmMark className={styles.mark} aria-hidden="true" />
      <span className={styles.label}>{text}</span>
    </>
  );

  // The gesture path: a genuine button so the click can resume the AudioContext
  // and prompt for the mic (browsers gate both behind a user gesture).
  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
      >
        {inner}
      </button>
    );
  }

  // The discoverability path: a plain navigation link to the standalone route.
  return (
    <Link className={classes} to={to ?? '/morning'}>
      {inner}
    </Link>
  );
}
