import { Link } from 'react-router-dom';

/** Site footer with Privacy/Terms links and the standing honest-framing line. */
export default function Footer() {
  return (
    <footer
      style={{
        marginTop: '2rem',
        padding: '1rem',
        borderTop: '1px solid var(--panel-border)',
        background: 'var(--panel-bg)',
        fontFamily: 'var(--mono)',
        fontSize: '0.78rem',
        color: 'var(--fg-muted)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem 1.25rem',
        alignItems: 'center',
      }}
    >
      <span>Omalyzer — a within-person acoustic measure, not a diagnosis.</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '1.25rem' }}>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/science">Science</Link>
      </span>
    </footer>
  );
}
