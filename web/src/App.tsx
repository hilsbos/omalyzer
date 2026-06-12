import { Suspense, lazy, useLayoutEffect } from 'react';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import Footer from './components/Footer';
import OmLockup from './components/OmLockup';
import RequireAuth from './auth/RequireAuth';
import { useAuth } from './auth/AuthProvider';

// Code-split every page except the landing page: each route loads its own
// chunk on first visit. LivePage pulls the WASM glue (via useAnalyzer) into
// its chunk, so the analyzer never weighs down the marketing pages.
const LivePage = lazy(() => import('./pages/LivePage'));
const SciencePage = lazy(() => import('./pages/SciencePage'));
const SignInPage = lazy(() => import('./pages/SignInPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));

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

/** SPA route changes keep the old scroll position — reset to the top on every
 *  navigation (before paint, so the new page never flashes mid-scroll). The
 *  /analyze console is position-fixed and unaffected either way. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Marketing/app chrome: parchment masthead + footer wrapping the page Outlet. */
function SiteLayout() {
  return (
    <>
      <Nav />
      <Outlet />
      <Footer />
    </>
  );
}

/** Shown while a lazy route chunk loads — one dim mono line, parchment-quiet. */
function RouteFallback() {
  return (
    <div
      style={{
        padding: 'var(--s-lg)',
        color: 'var(--ink-dim, var(--accent))',
        opacity: 0.5,
        fontSize: 'var(--t-label)',
      }}
    >
      loading…
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Standalone full-viewport console — NO marketing nav/footer. */}
          <Route path="/analyze" element={<LivePage />} />

          {/* Everything else gets the parchment nav + footer chrome. */}
          <Route element={<SiteLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/science" element={<SciencePage />} />
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
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
