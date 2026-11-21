import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest, getArtistForUser } from '@/lib/auth-server';

export const runtime = 'nodejs';
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
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
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artistProfile = await getArtistForUser(supabase, user.id);
    if (!artistProfile) return NextResponse.json({ error: 'Create your Artist profile before listing an artwork.' }, { status: 403 });
    if (artistProfile.is_suspended) return NextResponse.json({ error: 'Your Artist account is currently suspended by the Artiste owner. Please contact support.' }, { status: 403 });
    const { data: payoutAccount, error: payoutError } = await supabase.from('artist_payout_accounts').select('verified_at').eq('artist_id', artistProfile.id).maybeSingle();
    if (payoutError) throw payoutError;
    if (!payoutAccount?.verified_at) return NextResponse.json({ error: 'Complete your IFSC-verified bank / UPI payout details before listing artwork.' }, { status: 403 });
    if (!artistProfile.is_approved) {
      const { error: activateError } = await supabase.from('artists').update({ is_approved: true }).eq('id', artistProfile.id).eq('is_suspended', false);
      if (activateError) throw activateError;
      const { error: publishError } = await supabase.from('paintings').update({ is_approved: true }).eq('artist_id', artistProfile.id).eq('is_sold', false);
      if (publishError) throw publishError;
    }
    const form = await request.formData();
    const submittedArtistId = String(form.get('artist_id') || '').trim();
    if (submittedArtistId && submittedArtistId !== artistProfile.id) {
      return NextResponse.json({ error: 'The submitted Artist profile does not match your signed-in account.' }, { status: 403 });
    }
    const photo = form.get('photo');
    if (!photo || typeof photo.arrayBuffer !== 'function' || !types.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Upload a JPG, PNG, WEBP, or AVIF painting photo up to 8 MB.' }, { status: 400 });
    const title = String(form.get('title') || '').trim();
    const medium = String(form.get('medium') || '').trim();
    const dimensions = String(form.get('dimensions') || '').trim();
    const requestedCategory = String(form.get('category') || 'Painting').trim();
    const category = requestedCategory === 'Photography' || requestedCategory === 'Fine-Art Photography' ? 'Photography' : requestedCategory === 'Painting' || requestedCategory === 'Original Painting' ? 'Painting' : null;
    if (!category) return NextResponse.json({ error: 'Choose Original Painting or Fine-Art Photography.' }, { status: 400 });
    const numeric = {};
    for (const field of ['price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg']) {
      numeric[field] = Number(form.get(field));
      if (!Number.isFinite(numeric[field]) || numeric[field] <= 0) return NextResponse.json({ error: `${field.replaceAll('_', ' ')} must be a positive number.` }, { status: 400 });
    }
    if (numeric.weight_kg < 0.2) return NextResponse.json({ error: 'Packed weight must be at least 0.2 kg.' }, { status: 400 });
    if (!title || !medium || !dimensions || title.length > 120 || medium.length > 120 || dimensions.length > 100) return NextResponse.json({ error: 'Enter a valid title, medium, and canvas size.' }, { status: 400 });
    uploaded = `${artistProfile.id}/${crypto.randomUUID()}.${ext[photo.type]}`;
    const { error: uploadError } = await supabase.storage.from('paintings').upload(uploaded, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
    if (uploadError) throw uploadError;
    const imageUrl = supabase.storage.from('paintings').getPublicUrl(uploaded).data.publicUrl;
    const { data, error } = await supabase.from('paintings').insert({
      title, medium, dimensions, category, ...numeric, image_url: imageUrl, is_sold: false,
      artist_id: artistProfile.id, artist_name: artistProfile.artist_name, avatar_url: artistProfile.avatar_url || artistProfile.profile_photo_url || '', is_approved: true, pickup_pincode: null, pickup_location: 'Primary',
    }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ painting: data, message: `Your ${category === 'Photography' ? 'fine-art photograph' : 'original painting'} is now published in the Artiste gallery.` }, { status: 201 });
  } catch (error) {
    if (uploaded) { try { await requireServiceRole().storage.from('paintings').remove([uploaded]); } catch {} }
    return NextResponse.json({ error: error.message || 'Artwork upload failed.' }, { status: 400 });
  }
}
