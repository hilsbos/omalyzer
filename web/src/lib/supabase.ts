import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null when the Supabase env is absent. The public site and /analyze run
 * without it — only sign-in and saving oms need a configured client, and
 * those flows degrade through AuthProvider's `configured: false`.
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true, // store session in localStorage across reloads
          autoRefreshToken: true, // keep access token fresh
          detectSessionInUrl: true, // parse the magic-link token from the URL on return
        },
      })
    : null;

/** Call-time guard for the auth-gated flows (saving, playing, deleting oms). */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Accounts are not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env.local',
    );
  }
  return supabase;
}
