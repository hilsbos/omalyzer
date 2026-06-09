import { Link, Route, Routes } from 'react-router-dom';
import LivePage from './pages/LivePage';
import HomePage from './pages/HomePage';
import SciencePage from './pages/SciencePage';
import SignInPage from './pages/SignInPage';
import DashboardPage from './pages/DashboardPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import Footer from './components/Footer';
import OmLockup from './components/OmLockup';
import RequireAuth from './auth/RequireAuth';
import { useAuth } from './auth/AuthProvider';

const navLinkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
  fontFamily: 'var(--serif)',
  fontSize: 'var(--t-label)',
  letterSpacing: 'var(--ls-smallcaps)',
  fontVariantCaps: 'all-small-caps',
  fontFeatureSettings: '"smcp", "c2sc", "kern"',
};

function Nav() {
  const { user, signOut } = useAuth();

  return (
    <nav
      style={{
        display: 'flex',
        gap: 'var(--s-lg)',
        alignItems: 'center',
        padding: 'var(--s-sm) var(--s-lg)',
        borderBottom: '1px solid var(--rule)',
        // parchment masthead — transparent so the body grain shows through
        background: 'transparent',
      }}
    >
      {/* Masthead lockup — runs the inscription draw once on load. */}
      <OmLockup to="/" />
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-lg)', alignItems: 'center' }}>
        <Link to="/science" style={navLinkStyle}>
          Science
        </Link>
        <Link to="/analyze" style={navLinkStyle}>
          Analyze
        </Link>
        {user ? (
          <>
            <Link to="/dashboard" style={navLinkStyle}>
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              style={{
                ...navLinkStyle,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link to="/signin" style={navLinkStyle}>
            Sign in
          </Link>
        )}
      </span>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/science" element={<SciencePage />} />
        <Route path="/analyze" element={<LivePage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
      </Routes>
      <Footer />
    </>
  );
}
