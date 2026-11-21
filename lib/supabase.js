import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient({ privileged = false } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
  const key = privileged ? serviceKey : anonKey;
  if (privileged && !serviceKey) throw new Error('Server setup incomplete: add SUPABASE_SERVICE_ROLE_KEY to the server environment.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'artiste-art-store' } },
  });
}

export function requireServiceRole() {
  return getSupabaseClient({ privileged: true });
}
