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

function storagePathFromUrl(url) {
  const marker = '/storage/v1/object/public/paintings/';
  const position = String(url || '').indexOf(marker);
  return position >= 0 ? decodeURIComponent(String(url).slice(position + marker.length)) : null;
}

export async function PATCH(request, { params }) {
  const uploadedPaths = [];
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const { id } = await params;
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (!(await isArtistFoundingApproved(supabase, artist))) {
      return NextResponse.json({ error: 'Locked — This section will only open once Artiste approves your Founding Artist application.' }, { status: 403 });
    }
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: existing, error: existingError } = await supabase.from('paintings').select('*').eq('id', id).eq('artist_id', artist.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: 'Artwork not found.' }, { status: 404 });

    const contentType = request.headers.get('content-type') || '';
    let body = {};
    let newPhotos = [];
    let requestedGalleryImages = null;
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        if (key !== 'photos' && key !== 'photo' && typeof value === 'string') body[key] = value;
      }
      if (body.gallery_images !== undefined) {
        try { requestedGalleryImages = JSON.parse(body.gallery_images); } catch { return NextResponse.json({ error: 'The photo gallery selection is invalid.' }, { status: 400 }); }
      }
      newPhotos = [...form.getAll('photos'), form.get('photo')].filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    } else {
      body = await request.json();
      if (body.gallery_images !== undefined) requestedGalleryImages = body.gallery_images;
    }

    const allowed = ['title', 'medium', 'dimensions', 'description', 'framed_status', 'price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm', 'category', 'edition_details', 'print_details'];
    const update = {};
    for (const key of allowed) if (body[key] !== undefined) update[key] = body[key];
    if (update.framed_status !== undefined && !['Framed', 'Unframed'].includes(update.framed_status)) return NextResponse.json({ error: 'Choose Framed or Unframed.' }, { status: 400 });

    if (body.stock_quantity !== undefined) {
      const quantity = Number(body.stock_quantity);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10000) return NextResponse.json({ error: 'Stock quantity must be a whole number from 0 to 10,000.' }, { status: 400 });
      update.stock_quantity = quantity;
      update.is_sold = quantity <= 0;
    }
    if (body.is_sold !== undefined) {
      if (body.is_sold !== true) return NextResponse.json({ error: 'Use the stock controls to restock an item.' }, { status: 400 });
      update.stock_quantity = 0;
      update.is_sold = true;
    }
    if (existing.is_sold && Object.keys(update).some((key) => !['stock_quantity', 'is_sold'].includes(key))) return NextResponse.json({ error: 'Restock this sold-out item before editing its details.' }, { status: 409 });
    for (const key of ['price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm']) {
      if (update[key] !== undefined && (!Number.isFinite(Number(update[key])) || Number(update[key]) <= 0)) return NextResponse.json({ error: `${key} must be a positive number.` }, { status: 400 });
    }
    if (update.weight_kg !== undefined && Number(update.weight_kg) < 0.2) return NextResponse.json({ error: 'Packed weight must be at least 0.2 kg.' }, { status: 400 });
    if (update.category !== undefined && !['Painting', 'Photography'].includes(update.category)) return NextResponse.json({ error: 'Choose Painting or Photography as the art form.' }, { status: 400 });
    if (['title', 'medium', 'dimensions'].some((key) => update[key] !== undefined && !String(update[key]).trim())) return NextResponse.json({ error: 'Title, medium and dimensions cannot be blank.' }, { status: 400 });

    const limit = artist.creator_role === 'Photographer' ? 2 : 4;
    const previous = Array.isArray(existing.gallery_images) && existing.gallery_images.length ? existing.gallery_images : [existing.image_url].filter(Boolean);
    let retained = previous;
    if (requestedGalleryImages !== null) {
      if (!Array.isArray(requestedGalleryImages) || requestedGalleryImages.some((url) => typeof url !== 'string' || !previous.includes(url))) {
        return NextResponse.json({ error: 'Only photos already attached to this artwork can be retained.' }, { status: 400 });
      }
      retained = [...new Set(requestedGalleryImages)];
      if (!retained.length && !newPhotos.length) return NextResponse.json({ error: 'Keep at least one artwork photo.' }, { status: 400 });
      update.gallery_images = retained;
    }

    if (newPhotos.length) {
      if (retained.length + newPhotos.length > limit) return NextResponse.json({ error: `This ${artist.creator_role === 'Photographer' ? 'Photographer' : 'Painter'} studio may store up to ${limit} photos per artwork.` }, { status: 400 });
      const appended = [];
      for (const photo of newPhotos) {
        if (!IMAGE_TYPES.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Each artwork photo must be JPG, PNG, WEBP or AVIF and no larger than 8 MB.' }, { status: 400 });
        const path = `${artist.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[photo.type]}`;
        const { error: uploadError } = await supabase.storage.from('paintings').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        appended.push(supabase.storage.from('paintings').getPublicUrl(path).data.publicUrl);
      }
      update.gallery_images = [...retained, ...appended];
    }

    if (update.gallery_images !== undefined) {
      if (!update.gallery_images.length) return NextResponse.json({ error: 'Keep at least one artwork photo.' }, { status: 400 });
      update.image_url = update.gallery_images[0];
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No changes supplied.' }, { status: 400 });
    const { data, error } = await supabase.from('paintings').update(update).eq('id', id).eq('artist_id', artist.id).select('*').single();
    if (error) throw error;
    const removedPaths = previous.filter((url) => !data.gallery_images?.includes(url)).map(storagePathFromUrl).filter(Boolean);
    if (removedPaths.length) { try { await supabase.storage.from('paintings').remove(removedPaths); } catch {} }
    return NextResponse.json({ painting: data });
  } catch (error) {
    if (uploadedPaths.length) { try { await requireServiceRole().storage.from('paintings').remove(uploadedPaths); } catch {} }
    return NextResponse.json({ error: error.message || 'Could not update artwork.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const { id } = await params;
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (!(await isArtistFoundingApproved(supabase, artist))) {
      return NextResponse.json({ error: 'Locked — This section will only open once Artiste approves your Founding Artist application.' }, { status: 403 });
    }
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: painting, error: readError } = await supabase.from('paintings').select('id,image_url,gallery_images').eq('id', id).eq('artist_id', artist.id).single();
    if (readError) throw readError;
    const { error } = await supabase.from('paintings').delete().eq('id', id).eq('artist_id', artist.id);
    if (error) throw error;
    const urls = [...new Set([painting.image_url, ...(Array.isArray(painting.gallery_images) ? painting.gallery_images.map((image) => typeof image === 'string' ? image : image?.url) : [])].filter(Boolean))];
    const paths = urls.map(storagePathFromUrl).filter(Boolean);
    if (paths.length) await supabase.storage.from('paintings').remove(paths);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not delete artwork.' }, { status: 400 });
  }
}
