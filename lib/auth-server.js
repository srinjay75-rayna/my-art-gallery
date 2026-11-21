import { requireServiceRole } from '@/lib/supabase';

export async function getUserFromRequest(request, { optional = false, accountType = null } = {}) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    if (optional) return null;
    throw new Error('Please sign in to continue.');
  }
  const token = match[1].trim();
  if (!token) {
    if (optional) return null;
    throw new Error('Your sign-in session has expired. Please sign in again.');
  }
  const supabase = requireServiceRole();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    if (optional) return null;
    throw new Error('Your sign-in session is invalid or has expired. Please sign in again.');
  }
  if (!data.user.email_confirmed_at) {
    if (optional) return null;
    throw new Error('Please verify your email address before continuing.');
  }
  if (accountType && data.user.user_metadata?.account_type && data.user.user_metadata.account_type !== accountType) {
    if (optional) return null;
    throw new Error(`This page is for ${accountType === 'artist' ? 'Artists' : 'Customers'} only. Please use the correct Artiste portal.`);
  }
  // Supabase validates the token above; require a signed Auth Methods Reference for a supported Artiste sign-in method.
  let methods = [];
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    methods = Array.isArray(payload.amr) ? payload.amr.filter((entry) => entry?.method && entry.method !== 'token_refresh').sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).map((entry) => entry.method) : [];
  } catch {}
  const latestNonRefresh = methods[0];
  if (!['otp', 'email/signup', 'magiclink', 'email', 'password'].includes(latestNonRefresh)) {
    if (optional) return null;
    throw new Error('For your security, sign in using an Artiste email code or your account password.');
  }
  return data.user;
}

export async function getArtistForUser(supabase, userId) {
  const { data, error } = await supabase.from('artists').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
