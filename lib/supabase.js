import { createClient } from '@supabase/supabase-js';

const SAFE_RETRY_STATUSES = new Set([502, 503, 504]);

async function resilientSupabaseFetch(input, init = {}) {
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return fetch(input, init);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!SAFE_RETRY_STATUSES.has(response.status) || attempt === 2) return response;
      // Release the retry response before issuing another read request.
      try { await response.body?.cancel(); } catch {}
      // Only read-only requests are retried; writes and RPCs are never replayed.
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    } catch (error) {
      lastError = error;
      if (attempt === 2 || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw lastError || new Error('Supabase read request failed.');
}

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
    global: { headers: { 'X-Client-Info': 'artiste-art-store' }, fetch: resilientSupabaseFetch },
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
