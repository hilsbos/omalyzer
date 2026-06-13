import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const card: React.CSSProperties = {
  maxWidth: '30rem',
  margin: '0 auto',
  padding: 'var(--s-2xl) var(--s-lg) var(--s-4xl)',
  color: 'var(--fg)',
};

const fieldStyle: React.CSSProperties = {
  fontFamily: 'var(--serif)',
  fontSize: 'var(--t-body)',
  padding: 'var(--s-2xs) 0',
  border: 'none',
  borderBottom: '1px solid var(--rule)',
  background: 'transparent',
  color: 'var(--ink)',
  outline: 'none',
};

const buttonStyle = (busy: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--s-2xs)',
  alignSelf: 'flex-start',
  minHeight: 'var(--tap)',
  padding: 'var(--s-xs) var(--s-lg)',
  border: '1px solid var(--rule)',
  borderRadius: 0,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontFamily: 'var(--serif-display)',
  fontWeight: 420,
  fontSize: 'var(--t-body)',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

// Supabase Email OTP length is 6 (matching the sibling project, where 8 bricked
// sign-in). The input tolerates 6–10 so a server-side length drift degrades
// instead of blocking; the copy assumes 6.
const CODE_LEN = 6;
const CODE_MAX = 10;

export default function SignInPage() {
  useDocumentTitle('omalyzer — sign in');
  const { sendEmailCode, verifyEmailCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Where to land after sign-in: wherever RequireAuth bounced from, else dashboard.
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/dashboard';

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resent, setResent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function onSendEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    const { error } = await sendEmailCode(email.trim());
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setStep('code');
      setCode('');
      // focus the code field once it mounts
      requestAnimationFrame(() => codeRef.current?.focus());
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    if (error) {
      setBusy(false);
      setErrorMsg(error.message);
    } else {
      // session lands via onAuthStateChange; go where they were headed.
      navigate(from, { replace: true });
    }
  }

  async function onResend() {
    setBusy(true);
    setErrorMsg('');
    const { error } = await sendEmailCode(email.trim());
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setResent(true);
      setCode('');
      codeRef.current?.focus();
    }
  }

  if (step === 'code') {
    return (
      <main className="instrument" style={card}>
        <div className="section-label">
          <span className="roman">II</span>enter your code
        </div>
        <h1 style={{ fontSize: 'var(--t-disp)', margin: 'var(--s-xs) 0 var(--s-md)' }}>
          Enter your code
        </h1>
        <p style={{ color: 'var(--ink-soft)', marginBottom: 'var(--s-lg)' }}>
          We emailed a {CODE_LEN}-digit code to <strong>{email}</strong>. Enter it
          below to sign in. The code expires shortly.
        </p>
        <form
          onSubmit={onVerify}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-md)', maxWidth: '22rem' }}
        >
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_MAX}
            required
            placeholder="000000"
            aria-label={`${CODE_LEN}-digit sign-in code`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX))}
            style={{
              ...fieldStyle,
              fontFamily: 'var(--num)',
              fontSize: 'var(--t-md)',
              letterSpacing: '0.5em',
            }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--rule)')}
          />
          <button type="submit" disabled={busy || code.length < CODE_LEN} style={buttonStyle(busy)}>
            {busy ? 'Verifying…' : 'Verify & sign in'}
            <span aria-hidden="true">→</span>
          </button>
          {errorMsg && <p style={{ color: 'var(--error)', margin: 0 }}>{errorMsg}</p>}
          <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-label)', margin: 0 }}>
            {resent ? 'New code sent. ' : "Didn't get it? "}
            <button
              type="button"
              onClick={onResend}
              disabled={busy}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                cursor: busy ? 'default' : 'pointer',
                font: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Resend code
            </button>
            {' · '}
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setErrorMsg('');
                setResent(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                cursor: 'pointer',
                font: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Use a different email
            </button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="instrument" style={card}>
      <div className="section-label">
        <span className="roman">I</span>sign in
      </div>
      <h1 style={{ fontSize: 'var(--t-disp)', margin: 'var(--s-xs) 0 var(--s-md)' }}>
        Sign in — or create your account
      </h1>
      <p style={{ color: 'var(--ink-soft)', marginBottom: 'var(--s-lg)' }}>
        Enter your email and we&rsquo;ll send a one-time {CODE_LEN}-digit code. If
        you&rsquo;re new, it creates your account. No password to remember.
      </p>
      <form
        onSubmit={onSendEmail}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-md)', maxWidth: '22rem' }}
      >
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={fieldStyle}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--rule)')}
        />
        <button type="submit" disabled={busy} style={buttonStyle(busy)}>
          {busy ? 'Sending…' : 'Email me a code'}
          <span aria-hidden="true">→</span>
        </button>
        {errorMsg && <p style={{ color: 'var(--error)', margin: 0 }}>{errorMsg}</p>}
      </form>
    </main>
  );
}
