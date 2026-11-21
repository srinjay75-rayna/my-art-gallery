import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest, getArtistForUser } from '@/lib/auth-server';

export const runtime = 'nodejs';
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    const supabase = requireServiceRole();
    const artist = await getArtistForUser(supabase, user.id);
    if (!artist) return NextResponse.json({ paintings: [], error: 'Create your artist profile first.' }, { status: 404 });
    const paintings = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('paintings').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false }).range(start, start + 999);
      if (error) throw error;
      paintings.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return NextResponse.json({ paintings });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not load your artworks.' }, { status: 401 }); }
}

export async function POST(request) {
  let uploaded = null;
  try {
    const user = await getUserFromRequest(request);
    const supabase = requireServiceRole();
    const artist = await getArtistForUser(supabase, user.id);
    if (!artist) return NextResponse.json({ error: 'Create your artist profile before listing a painting.' }, { status: 403 });
    const form = await request.formData();
    const photo = form.get('photo');
    if (!photo || typeof photo.arrayBuffer !== 'function' || !types.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Upload a JPG, PNG, WEBP, or AVIF painting photo up to 8 MB.' }, { status: 400 });
    const title = String(form.get('title') || '').trim();
    const medium = String(form.get('medium') || '').trim();
    const dimensions = String(form.get('dimensions') || '').trim();
    const numeric = {};
    for (const field of ['price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg']) {
      numeric[field] = Number(form.get(field));
      if (!Number.isFinite(numeric[field]) || numeric[field] <= 0) return NextResponse.json({ error: `${field.replaceAll('_', ' ')} must be a positive number.` }, { status: 400 });
    }
    if (!title || !medium || !dimensions || title.length > 120 || medium.length > 120 || dimensions.length > 100) return NextResponse.json({ error: 'Enter a valid title, medium, and canvas size.' }, { status: 400 });
    uploaded = `${artist.id}/${crypto.randomUUID()}.${ext[photo.type]}`;
    const { error: uploadError } = await supabase.storage.from('paintings').upload(uploaded, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
    if (uploadError) throw uploadError;
    const imageUrl = supabase.storage.from('paintings').getPublicUrl(uploaded).data.publicUrl;
    const { data, error } = await supabase.from('paintings').insert({
      title, medium, dimensions, ...numeric, image_url: imageUrl, is_sold: false,
      artist_id: artist.id, artist_name: artist.artist_name, is_approved: false,
    }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ painting: data, message: 'Artwork submitted for owner approval.' }, { status: 201 });
  } catch (error) {
    if (uploaded) { try { await requireServiceRole().storage.from('paintings').remove([uploaded]); } catch {} }
    return NextResponse.json({ error: error.message || 'Artwork upload failed.' }, { status: 400 });
  }
}
