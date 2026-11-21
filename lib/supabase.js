import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient({ privileged = false } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL in .env.local.');
  const key = privileged ? serviceKey : anonKey;
  if (privileged && !serviceKey) throw new Error('Server setup incomplete: add SUPABASE_SERVICE_ROLE_KEY to the server environment.');
  if (!key) throw new Error('Set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'artiste-art-store' } },
  });
}

// Public-facing Server Components use the service-role key when configured so
// RLS cannot unexpectedly hide approved public profiles. The public anon key is
// retained as a safe fallback for deployments that have not configured it.
export function getPublicServerSupabaseClient() {
  return getSupabaseClient({ privileged: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) });
}

export function requireServiceRole() {
  return getSupabaseClient({ privileged: true });
}
