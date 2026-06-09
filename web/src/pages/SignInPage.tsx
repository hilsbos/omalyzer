import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';

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
      <main style={{ padding: '2rem', fontFamily: 'var(--mono)' }}>
        <h1>Check your email</h1>
        <p>
          We sent a magic sign-in link to <strong>{email}</strong>. Open it on this
          device to continue.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'var(--mono)' }}>
      <h1>Sign in</h1>
      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          maxWidth: 360,
        }}
      >
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
        {status === 'error' && <p style={{ color: 'crimson' }}>{errorMsg}</p>}
      </form>
    </main>
  );
}
