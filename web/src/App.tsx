import { Link, Route, Routes } from 'react-router-dom';
import LivePage from './pages/LivePage';
import HomePage from './pages/HomePage';
import SciencePage from './pages/SciencePage';

function Nav() {
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
      </Routes>
    </>
  );
}
