import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient({ privileged = false } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
  }

  // Prefer the service role for server-only API routes. It bypasses RLS, so it
  // must never be returned to a Client Component or exposed in a NEXT_PUBLIC var.
  const key = privileged && serviceKey ? serviceKey : anonKey;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'rangrekha-art-gallery' } },
  });
}

export function requireServiceRole() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server setup incomplete: add SUPABASE_SERVICE_ROLE_KEY to enable secure admin, order, and payment operations.');
  }
  return getSupabaseClient({ privileged: true });
}
