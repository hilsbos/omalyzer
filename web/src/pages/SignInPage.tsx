import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';

const card: React.CSSProperties = {
  maxWidth: '30rem',
  margin: '0 auto',
  padding: 'var(--s-2xl) var(--s-lg) var(--s-4xl)',
  color: 'var(--fg)',
};

export default function SignInPage() {
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    const { error } = await signInWithOtp(email.trim());
    if (error) {
      setErrorMsg(error.message);
      setStatus('error');
    } else {
      setStatus('sent');
    }
  }

  if (status === 'sent') {
    return (
      <main style={card}>
        <div className="section-label">
          <span className="roman">II</span>check your email
        </div>
        <h1 style={{ fontSize: 'var(--t-disp)', margin: 'var(--s-xs) 0 var(--s-md)' }}>
          Check your email
        </h1>
        <p>
          We sent a magic sign-in link to <strong>{email}</strong>. Open it on this
          device to continue.
        </p>
      </main>
    );
  }

  return (
    <main style={card}>
      <div className="section-label">
        <span className="roman">I</span>sign in
      </div>
      <h1 style={{ fontSize: 'var(--t-disp)', margin: 'var(--s-xs) 0 var(--s-md)' }}>
        Sign in
      </h1>
      <p style={{ color: 'var(--ink-soft)', marginBottom: 'var(--s-lg)' }}>
        Enter your email and we'll send a one-time magic link. No password to
        remember.
      </p>
      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s-md)',
          maxWidth: '22rem',
        }}
      >
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 'var(--t-body)',
            padding: 'var(--s-2xs) 0',
            border: 'none',
            borderBottom: '1px solid var(--rule)',
            background: 'transparent',
            color: 'var(--ink)',
            outline: 'none',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--rule)')}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          style={{
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
            cursor: status === 'sending' ? 'default' : 'pointer',
            opacity: status === 'sending' ? 0.6 : 1,
          }}
        >
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
          <span aria-hidden="true">→</span>
        </button>
        {status === 'error' && <p style={{ color: 'var(--error)', margin: 0 }}>{errorMsg}</p>}
      </form>
    </main>
  );
}
