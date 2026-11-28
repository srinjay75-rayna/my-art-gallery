import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { isArtistFoundingApproved } from '@/lib/artist-approval';

export const runtime = 'nodejs';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
async function currentArtist(supabase, user) {
  const role = user.user_metadata?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
  const { data, error } = await supabase.from('artists').select('*').eq('user_id', user.id).eq('creator_role', role).maybeSingle();
  if (error) throw error;
  if (!data && role === 'Painter') {
    const legacy = await supabase.from('artists').select('*').eq('user_id', user.id).is('creator_role', null).maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data || null;
  }
  return data;
}
export async function GET(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await currentArtist(supabase, user);
    if (!artist) return NextResponse.json({ achievements: [] });
    const { data, error } = await supabase.from('artist_achievements').select('*').eq('artist_id', artist.id).order('achievement_year', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ achievements: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load achievements.' }, { status: 401 });
  }
}
export async function POST(request) {
  const uploaded = [];
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await currentArtist(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (artist.is_suspended || !(await isArtistFoundingApproved(supabase, artist))) return NextResponse.json({ error: 'Achievements are available after Artist Studio approval.' }, { status: 403 });
    const form = await request.formData();
    const title = String(form.get('title') || '').trim().slice(0, 180);
    const year = Number(form.get('year'));
    const description = String(form.get('description') || '').trim().slice(0, 1600);
    const photos = form.getAll('photos').filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    if (title.length < 2 || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) return NextResponse.json({ error: 'Enter a valid achievement title and year.' }, { status: 400 });
    if (photos.length < 1 || photos.length > 3 || photos.some((file) => !TYPES.has(file.type) || file.size > 8 * 1024 * 1024)) return NextResponse.json({ error: 'Upload 1–3 JPG, PNG, WEBP or AVIF achievement photos, up to 8 MB each.' }, { status: 400 });
    const urls = [];
    for (const photo of photos) {
      const path = `${artist.id}/${crypto.randomUUID()}.${EXT[photo.type]}`;
      const { error } = await supabase.storage.from('artist-achievements').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      uploaded.push(path);
      urls.push(supabase.storage.from('artist-achievements').getPublicUrl(path).data.publicUrl);
    }
    const { data, error } = await supabase.from('artist_achievements').insert({ artist_id: artist.id, title, achievement_year: year, description, photo_urls: urls }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ achievement: data, message: 'Achievement added to your Artist Studio.' }, { status: 201 });
  } catch (error) {
    if (uploaded.length) { try { await requireServiceRole().storage.from('artist-achievements').remove(uploaded); } catch {} }
    return NextResponse.json({ error: error.message || 'Could not save achievement.' }, { status: 400 });
  }
}
export async function DELETE(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const id = String(new URL(request.url).searchParams.get('id') || '');
    if (!/^[0-9a-f-]{20,40}$/i.test(id)) return NextResponse.json({ error: 'A valid achievement ID is required.' }, { status: 400 });
    const supabase = requireServiceRole();
    const artist = await currentArtist(supabase, user);
    const { data: row, error: readError } = await supabase.from('artist_achievements').select('*').eq('id', id).eq('artist_id', artist?.id || '').maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: 'Achievement not found.' }, { status: 404 });
    const { error } = await supabase.from('artist_achievements').delete().eq('id', id).eq('artist_id', artist.id);
    if (error) throw error;
    const paths = (Array.isArray(row.photo_urls) ? row.photo_urls : []).map((url) => { const marker = '/artist-achievements/'; const index = String(url).indexOf(marker); return index >= 0 ? decodeURIComponent(String(url).slice(index + marker.length)) : null; }).filter(Boolean);
    if (paths.length) { const { error: storageError } = await supabase.storage.from('artist-achievements').remove(paths); if (storageError) console.warn('Achievement image cleanup needs attention:', storageError.message); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not remove achievement.' }, { status: 400 });
  }
}
