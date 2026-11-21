import { requireServiceRole } from '@/lib/supabase';

export async function getUserFromRequest(request, { optional = false } = {}) {
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
  return data.user;
}

export async function getArtistForUser(supabase, userId) {
  const { data, error } = await supabase.from('artists').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
