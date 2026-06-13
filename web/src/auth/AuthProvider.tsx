import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** False when the Supabase env is absent — auth degrades to signed-out and
   *  account CTAs route elsewhere; the rest of the site runs untouched. */
  configured: boolean;
  /** Step 1: email the one-time code (creates the account if new). */
  sendEmailCode: (email: string) => Promise<{ error: Error | null }>;
  /** Step 2: verify the code the user typed; on success the session is set
   *  via onAuthStateChange. */
  verifyEmailCode: (email: string, code: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No env → no client: degrade to { user: null, configured: false }.
    if (!supabase) {
      setLoading(false);
      return;
    }

    // 1. hydrate from any persisted session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // 2. subscribe to future auth changes (code verification, sign-out, refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: supabase !== null,
      sendEmailCode: async (email: string) => {
        if (!supabase) {
          return { error: new Error('Accounts are not configured on this deployment.') };
        }
        // No emailRedirectTo → with a token-based email template Supabase sends
        // a numeric code instead of a magic link. shouldCreateUser stays on
        // (default) so a first-time email still gets an account.
        const { error } = await supabase.auth.signInWithOtp({ email });
        return { error };
      },
      verifyEmailCode: async (email: string, code: string) => {
        if (!supabase) {
          return { error: new Error('Accounts are not configured on this deployment.') };
        }
        const { error } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'email',
        });
        return { error };
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
