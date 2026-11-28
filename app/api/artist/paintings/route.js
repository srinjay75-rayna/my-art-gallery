import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { isArtistFoundingApproved } from '@/lib/artist-approval';
import { calculatePhotographyGradePrices, getPrintLabCosts } from '@/lib/photography-pricing';

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
    const photographerStudio = artist.creator_role === 'Photographer';
    if (photographerStudio && category !== 'Photography') return NextResponse.json({ error: 'Photographer studios can publish Fine-Art Photography listings only.' }, { status: 400 });
    const limit = photographerStudio ? 4 : imageLimit(category);
    const photos = [...form.getAll('photos'), form.get('photo')].filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    if ((photographerStudio && (photos.length < 3 || photos.length > 4)) || (!photographerStudio && (photos.length < 1 || photos.length > limit))) return NextResponse.json({ error: photographerStudio ? 'Upload 3–4 high-resolution / preview photos for your Fine-Art Photography listing.' : `${category === 'Photography' ? 'Fine-Art Photography' : 'Original Paintings'} may include up to ${limit} photos per artwork.` }, { status: 400 });
    for (const photo of photos) {
      if (!IMAGE_TYPES.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Each artwork photo must be JPG, PNG, WEBP or AVIF and no larger than 8 MB.' }, { status: 400 });
    }

    const title = String(form.get('title') || '').trim();
    const medium = photographerStudio ? 'Fine-Art Photography' : String(form.get('medium') || '').trim();
    const dimensions = photographerStudio ? 'Grade I · 12 × 18 Inches · Edition of 30' : String(form.get('dimensions') || '').trim();
    const description = String(form.get('description') || '').trim().slice(0, 3000);
    const framedStatus = photographerStudio ? 'Unframed' : (form.get('framed_status') === 'Framed' ? 'Framed' : 'Unframed');
    const deliveryFormats = ['Stretched Canvas (Gallery-Wrapped, Unframed)', 'Framed Artwork (Canvas or Paper, Ready to Hang)', 'Rolled Canvas (Unstretched, Shipped in Protective Tube)', 'Unframed Fine-Art Paper / Print (Flat or Tube)', 'Rigid Panel / Canvas Board / Wood / Metal', 'Other (Specify exact format)'];
    const deliveryFormat = photographerStudio ? deliveryFormats[3] : String(form.get('delivery_format') || deliveryFormats[0]).trim();
    const deliveryFormatOther = String(form.get('delivery_format_other') || '').trim().slice(0, 160);
    const packingMode = photographerStudio ? 'self' : String(form.get('packing_mode') || 'self').trim();
    if (!deliveryFormats.includes(deliveryFormat)) return NextResponse.json({ error: 'Choose a supported artwork presentation format.' }, { status: 400 });
    if (deliveryFormat === 'Other (Specify exact format)' && !deliveryFormatOther) return NextResponse.json({ error: 'Specify the exact presentation and packing format.' }, { status: 400 });
    if (!['self', 'partner'].includes(packingMode)) return NextResponse.json({ error: 'Choose self-packing or Ganesh partner packing.' }, { status: 400 });
    const stockQuantity = photographerStudio ? 65 : Number(form.get('stock_quantity') || 1);
    const editionDetails = String(form.get('edition_details') || '').trim().slice(0, 180);
    const printDetails = String(form.get('print_details') || '').trim().slice(0, 240);
    if (!Number.isInteger(stockQuantity) || stockQuantity < 1 || stockQuantity > 10000) return NextResponse.json({ error: 'Stock quantity must be a whole number from 1 to 10,000.' }, { status: 400 });

    const numeric = {};
    let artistFeeGrade1 = null;
    if (photographerStudio) {
      artistFeeGrade1 = Number(form.get('artist_fee_grade_1'));
      if (!Number.isFinite(artistFeeGrade1) || artistFeeGrade1 <= 0 || artistFeeGrade1 > 100000000) return NextResponse.json({ error: 'Enter a valid positive Grade I Artist Fee.' }, { status: 400 });
      const gradeOne = calculatePhotographyGradePrices(artistFeeGrade1, getPrintLabCosts())[0];
      numeric.price = gradeOne.collector_price;
      numeric.weight_kg = 1; numeric.length_cm = 48; numeric.breadth_cm = 36; numeric.height_cm = 6;
    } else {
      for (const field of ['price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg']) {
        numeric[field] = Number(form.get(field));
        if (!Number.isFinite(numeric[field]) || numeric[field] <= 0) return NextResponse.json({ error: `${field.replaceAll('_', ' ')} must be a positive number.` }, { status: 400 });
      }
      if (numeric.weight_kg < 0.2) return NextResponse.json({ error: 'Packed weight must be at least 0.2 kg.' }, { status: 400 });
    }
    if (!title || title.length > 120 || (!photographerStudio && (!medium || !dimensions || medium.length > 120 || dimensions.length > 100))) return NextResponse.json({ error: 'Enter a valid artwork title, medium and dimensions.' }, { status: 400 });

    const galleryImages = [];
    for (const photo of photos) {
      const path = `${artist.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('paintings').upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      galleryImages.push(supabase.storage.from('paintings').getPublicUrl(path).data.publicUrl);
    }
    const { data, error } = await supabase.from('paintings').insert({
      title, medium, dimensions, description, framed_status: framedStatus, delivery_format: deliveryFormat, delivery_format_other: deliveryFormatOther, packing_mode: packingMode, gallery_images: galleryImages, certificate_id: `ART-COA-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      category, ...numeric, image_url: galleryImages[0], stock_quantity: stockQuantity, edition_details: photographerStudio ? 'Limited edition · 30 / 20 / 10 / 5 copies by grade' : editionDetails, print_details: photographerStudio ? 'Hahnemühle archival fine-art print and luxury framing by selected collector grade' : printDetails, artist_fee_grade_1: artistFeeGrade1, print_lab_managed: photographerStudio, is_sold: false,
      artist_id: artist.id, artist_name: artist.artist_name, avatar_url: artist.avatar_url || artist.profile_photo_url || '', is_approved: true, pickup_pincode: null, pickup_location: 'Primary',
    }).select('*').single();
    if (error) throw error;

    if (photographerStudio) {
      const rows = [{ grade: 1, edition_limit: 30 }, { grade: 2, edition_limit: 20 }, { grade: 3, edition_limit: 10 }, { grade: 4, edition_limit: 5 }].map((grade) => ({ painting_id: data.id, ...grade }));
      const { error: editionError } = await supabase.from('photography_editions').upsert(rows, { onConflict: 'painting_id,grade', ignoreDuplicates: true });
      if (editionError) { await supabase.from('paintings').delete().eq('id', data.id); throw editionError; }
    }

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
