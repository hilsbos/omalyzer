import { Link, Route, Routes } from 'react-router-dom';
import LivePage from './pages/LivePage';
import HomePage from './pages/HomePage';
import SciencePage from './pages/SciencePage';
import SignInPage from './pages/SignInPage';
import DashboardPage from './pages/DashboardPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import Footer from './components/Footer';
import RequireAuth from './auth/RequireAuth';
import { useAuth } from './auth/AuthProvider';

function Nav() {
  const { user, signOut } = useAuth();

  return (
    <nav
      style={{
        display: 'flex',
        gap: '1.25rem',
        alignItems: 'center',
        padding: '0.6rem 1rem',
        borderBottom: '1px solid var(--panel-border)',
        background: 'var(--panel-bg)',
        fontFamily: 'var(--mono)',
        fontSize: '0.9rem',
      }}
    >
      <Link to="/" style={{ fontWeight: 700 }}>
        Omalyzer
      </Link>
      <Link to="/science">Science</Link>
      <Link to="/analyze">Analyze</Link>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
        {user ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <button
              type="button"
              onClick={() => void signOut()}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                font: 'inherit',
                padding: 0,
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link to="/signin">Sign in</Link>
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
