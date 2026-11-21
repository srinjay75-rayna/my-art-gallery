import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    const supabase = requireServiceRole();
    const { data: artist, error } = await supabase.from('artists').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ artist, user: { id: user.id, email: user.email } });
  } catch (error) { return NextResponse.json({ error: error.message || 'Please sign in.' }, { status: 401 }); }
}

export async function POST(request) {
  let uploaded = null;
  try {
    const user = await getUserFromRequest(request);
    const form = await request.formData();
    const artistName = String(form.get('artist_name') || '').trim();
    const bio = String(form.get('bio') || '').trim();
    const city = String(form.get('city') || '').trim();
    const photo = form.get('photo');
    if (!artistName || artistName.length > 100 || bio.length > 1200 || city.length > 100) return NextResponse.json({ error: 'Enter a valid artist name, bio, and city.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: existing } = await supabase.from('artists').select('id,profile_photo_url,is_approved').eq('user_id', user.id).maybeSingle();
    let profilePhotoUrl = existing?.profile_photo_url || null;
    if (photo && typeof photo.arrayBuffer === 'function' && photo.size > 0) {
      if (!types.has(photo.type) || photo.size > 6 * 1024 * 1024) return NextResponse.json({ error: 'Use a JPG, PNG, WEBP, or AVIF profile photo up to 6 MB.' }, { status: 400 });
      uploaded = `${user.id}/${crypto.randomUUID()}.${ext[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('artist-profiles').upload(uploaded, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      profilePhotoUrl = supabase.storage.from('artist-profiles').getPublicUrl(uploaded).data.publicUrl;
    }
    if (!profilePhotoUrl) return NextResponse.json({ error: 'Please upload a portfolio/profile photo.' }, { status: 400 });
    const row = { user_id: user.id, artist_name: artistName, bio, city, profile_photo_url: profilePhotoUrl, is_approved: existing?.is_approved || false };
    const { data, error } = await supabase.from('artists').upsert(row, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    const { error: attributionError } = await supabase.from('paintings').update({ artist_name: artistName }).eq('artist_id', data.id);
    if (attributionError) throw attributionError;
    return NextResponse.json({ artist: data, message: data.is_approved ? 'Artist profile updated.' : 'Profile submitted. The Artiste team will review it before public listing.' }, { status: 201 });
  } catch (error) {
    if (uploaded) { try { await requireServiceRole().storage.from('artist-profiles').remove([uploaded]); } catch {} }
    return NextResponse.json({ error: error.message || 'Could not save artist profile.' }, { status: 400 });
  }
}
