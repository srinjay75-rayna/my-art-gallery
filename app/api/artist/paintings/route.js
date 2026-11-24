import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { isArtistFoundingApproved } from '@/lib/artist-approval';

export const runtime = 'nodejs';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

async function getArtistForPortal(supabase, user) {
  const role = user.user_metadata?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
  let { data, error } = await supabase.from('artists').select('*').eq('user_id', user.id).eq('creator_role', role).maybeSingle();
  if (error) throw error;
  if (!data && role === 'Painter') {
    const legacy = await supabase.from('artists').select('*').eq('user_id', user.id).is('creator_role', null).maybeSingle();
    if (legacy.error) throw legacy.error;
    data = legacy.data || null;
  }
  return data;
}

function imageLimit(category) { return category === 'Photography' ? 2 : 4; }

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ paintings: [], error: 'Create your artist profile first.' }, { status: 404 });
    const paintings = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('paintings').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false }).range(start, start + 999);
      if (error) throw error;
      paintings.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return NextResponse.json({ paintings });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load your artworks.' }, { status: 401 });
  }
}

export async function POST(request) {
  const uploadedPaths = [];
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Create your Artist profile before listing an artwork.' }, { status: 403 });
    if (!(await isArtistFoundingApproved(supabase, artist))) {
      return NextResponse.json({ error: 'Locked — This section will only open once Artiste approves your Founding Artist application.' }, { status: 403 });
    }
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is currently suspended by the Artiste owner. Please contact support.' }, { status: 403 });

    const form = await request.formData();
    const submittedArtistId = String(form.get('artist_id') || '').trim();
    if (submittedArtistId && submittedArtistId !== artist.id) return NextResponse.json({ error: 'The submitted Artist profile does not match your signed-in account.' }, { status: 403 });

    const requestedCategory = String(form.get('category') || 'Painting').trim();
    const category = requestedCategory === 'Photography' || requestedCategory === 'Fine-Art Photography' ? 'Photography' : requestedCategory === 'Painting' || requestedCategory === 'Original Painting' ? 'Painting' : null;
    if (!category) return NextResponse.json({ error: 'Choose Original Painting or Fine-Art Photography.' }, { status: 400 });
    const limit = imageLimit(category);
    const photos = [...form.getAll('photos'), form.get('photo')].filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    if (photos.length < 1 || photos.length > limit) return NextResponse.json({ error: `${category === 'Photography' ? 'Fine-Art Photography' : 'Original Paintings'} may include up to ${limit} photos per artwork.` }, { status: 400 });
    for (const photo of photos) {
      if (!IMAGE_TYPES.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Each artwork photo must be JPG, PNG, WEBP or AVIF and no larger than 8 MB.' }, { status: 400 });
    }

    const title = String(form.get('title') || '').trim();
    const medium = String(form.get('medium') || '').trim();
    const dimensions = String(form.get('dimensions') || '').trim();
    const description = String(form.get('description') || '').trim().slice(0, 3000);
    const framedStatus = form.get('framed_status') === 'Framed' ? 'Framed' : 'Unframed';
    const stockQuantity = Number(form.get('stock_quantity') || 1);
    const editionDetails = String(form.get('edition_details') || '').trim().slice(0, 180);
    const printDetails = String(form.get('print_details') || '').trim().slice(0, 240);
    if (!Number.isInteger(stockQuantity) || stockQuantity < 1 || stockQuantity > 10000) return NextResponse.json({ error: 'Stock quantity must be a whole number from 1 to 10,000.' }, { status: 400 });

    const numeric = {};
    for (const field of ['price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg']) {
      numeric[field] = Number(form.get(field));
      if (!Number.isFinite(numeric[field]) || numeric[field] <= 0) return NextResponse.json({ error: `${field.replaceAll('_', ' ')} must be a positive number.` }, { status: 400 });
    }
    if (numeric.weight_kg < 0.2) return NextResponse.json({ error: 'Packed weight must be at least 0.2 kg.' }, { status: 400 });
    if (!title || !medium || !dimensions || title.length > 120 || medium.length > 120 || dimensions.length > 100) return NextResponse.json({ error: 'Enter a valid title, medium and artwork dimensions.' }, { status: 400 });

    const galleryImages = [];
    for (const photo of photos) {
      const path = `${artist.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('paintings').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      galleryImages.push(supabase.storage.from('paintings').getPublicUrl(path).data.publicUrl);
    }
    const { data, error } = await supabase.from('paintings').insert({
      title, medium, dimensions, description, framed_status: framedStatus, gallery_images: galleryImages, certificate_id: `ART-COA-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      category, ...numeric, image_url: galleryImages[0], stock_quantity: stockQuantity, edition_details: editionDetails, print_details: printDetails, is_sold: false,
      artist_id: artist.id, artist_name: artist.artist_name, avatar_url: artist.avatar_url || artist.profile_photo_url || '', is_approved: true, pickup_pincode: null, pickup_location: 'Primary',
    }).select('*').single();
    if (error) throw error;

    if (!artist.is_approved) {
      const { error: activateError } = await supabase.from('artists').update({ is_approved: true, approved: true }).eq('id', artist.id).eq('is_suspended', false);
      if (activateError) throw activateError;
    }
    return NextResponse.json({ painting: data, message: `Your ${category === 'Photography' ? 'fine-art photograph' : 'original painting'} is now published in the Artiste gallery.` }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length) { try { await requireServiceRole().storage.from('paintings').remove(uploadedPaths); } catch {} }
    return NextResponse.json({ error: error.message || 'Artwork upload failed.' }, { status: 400 });
  }
}
