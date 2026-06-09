import { Link } from 'react-router-dom';

/** Site footer with Privacy/Terms links and the standing honest-framing line. */
export default function Footer() {
  return (
    <footer
      style={{
        marginTop: 'var(--s-3xl)',
        paddingTop: 'var(--s-xl)',
        paddingBottom: 'var(--s-xl)',
        paddingLeft: 'var(--s-lg)',
        paddingRight: 'var(--s-lg)',
        borderTop: '1px solid var(--rule)',
        fontFamily: 'var(--serif)',
        fontSize: 'var(--t-label)',
        color: 'var(--fg-muted)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--s-2xs) var(--s-lg)',
          alignItems: 'center',
        }}
      >
        <span>omalyzer — a within-person acoustic measure.</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-lg)' }}>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/science">Science</Link>
        </span>
      </div>
    </footer>
  );
}
