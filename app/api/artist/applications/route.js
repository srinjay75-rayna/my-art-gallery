import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const AGREEMENT_KEYS = ['original_work', 'commission_and_payout', 'secure_packing', 'promotion_permission'];

async function getArtist(supabase, user) {
  const role = user.user_metadata?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
  const { data, error } = await supabase.from('artists').select('*').eq('user_id', user.id).eq('creator_role', role).maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request) {
  const uploadedPaths = [];
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await getArtist(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Create your Creator profile before submitting the application.' }, { status: 404 });

    const form = await request.formData();
    const fullName = String(form.get('full_name') || '').trim();
    const studioName = String(form.get('studio_name') || '').trim();
    const whatsapp = String(form.get('whatsapp_number') || '').replace(/\D/g, '').slice(-10);
    const instagram = String(form.get('instagram_handle') || '').trim().replace(/^@/, '').slice(0, 60);
    const city = String(form.get('city') || '').trim();
    const pincode = String(form.get('pincode') || '').trim();
    const bio = String(form.get('art_style_bio') || '').trim();
    const photos = form.getAll('photos').filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    const agreementValues = Object.fromEntries(AGREEMENT_KEYS.map((key) => [key, form.get(`agreement_${key}`) === 'true']));
    const sentenceCount = bio.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;

    if (fullName.length < 2 || fullName.length > 100 || studioName.length < 2 || studioName.length > 100) return NextResponse.json({ error: 'Enter your full name and Artist / Studio name.' }, { status: 400 });
    if (!/^\d{10}$/.test(whatsapp)) return NextResponse.json({ error: 'Enter a valid 10-digit WhatsApp number.' }, { status: 400 });
    if (!city || !/^\d{6}$/.test(pincode)) return NextResponse.json({ error: 'Enter your city and valid 6-digit PIN code.' }, { status: 400 });
    if (sentenceCount < 1 || sentenceCount > 8 || bio.length > 1200) return NextResponse.json({ error: 'Write a short bio describing your art practice.' }, { status: 400 });
    if (photos.length < 3 || photos.length > 5) return NextResponse.json({ error: 'Upload 3–5 clear photographs of available original artworks.' }, { status: 400 });
    if (AGREEMENT_KEYS.some((key) => !agreementValues[key])) return NextResponse.json({ error: 'All four application agreements are mandatory.' }, { status: 400 });
    for (const photo of photos) {
      if (!IMAGE_TYPES.has(photo.type) || photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Each artwork photo must be JPG, PNG, WEBP or AVIF and no larger than 8 MB.' }, { status: 400 });
    }

    const artworkPhotos = [];
    for (const photo of photos) {
      const path = `applications/${artist.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('paintings').upload(path, Buffer.from(await photo.arrayBuffer()), {
        contentType: photo.type,
        cacheControl: '31536000',
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      artworkPhotos.push(supabase.storage.from('paintings').getPublicUrl(path).data.publicUrl);
    }

    const application = {
      artist_id: artist.id,
      user_id: user.id,
      full_name: fullName,
      studio_name: studioName,
      whatsapp_number: `+91${whatsapp}`,
      instagram_handle: instagram,
      city,
      pincode,
      art_style_bio: bio,
      artwork_photos: artworkPhotos,
      agreements: agreementValues,
      updated_at: new Date().toISOString(),
    };
    const { data: savedApplication, error: applicationError } = await supabase.from('artist_applications').insert(application).select('*').single();
    if (applicationError) throw applicationError;

    const { error: artistUpdateError } = await supabase.from('artists').update({
      artist_name: studioName,
      bio,
      city,
      instagram_handle: instagram ? `@${instagram}` : '',
      whatsapp_number: `+91${whatsapp}`,
      phone: `+91${whatsapp}`,
      latest_application_id: savedApplication.id,
      updated_at: new Date().toISOString(),
    }).eq('id', artist.id);
    if (artistUpdateError) throw artistUpdateError;

    return NextResponse.json({ application: savedApplication, message: 'Your Founding Artist application has been submitted successfully.' }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length) {
      try { await requireServiceRole().storage.from('paintings').remove(uploadedPaths); } catch {}
    }
    return NextResponse.json({ error: error.message || 'Could not submit the Artist application.' }, { status: 400 });
  }
}
