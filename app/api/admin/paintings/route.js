import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const paintings = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from('paintings').select('*').order('created_at', { ascending: false }).range(start, start + 999);
      if (error) throw error;
      paintings.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return NextResponse.json({ paintings });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load paintings.' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  let uploadedPath = null;
  try {
    const form = await request.formData();
    const photo = form.get('photo');
    if (!photo || typeof photo.arrayBuffer !== 'function') return NextResponse.json({ error: 'Painting photo is required.' }, { status: 400 });
    if (!allowedTypes.has(photo.type)) return NextResponse.json({ error: 'Use a JPG, PNG, WEBP, or AVIF image.' }, { status: 400 });
    if (photo.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Image must be 8 MB or smaller.' }, { status: 400 });

    const title = String(form.get('title') || '').trim();
    const medium = String(form.get('medium') || '').trim();
    const dimensions = String(form.get('dimensions') || '').trim();
    const numeric = {};
    for (const field of ['price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg']) {
      numeric[field] = Number(form.get(field));
      if (!Number.isFinite(numeric[field]) || numeric[field] <= 0) return NextResponse.json({ error: `${field.replaceAll('_', ' ')} must be a positive number.` }, { status: 400 });
    }
    if (!title || !medium || !dimensions) return NextResponse.json({ error: 'Title, medium, and canvas size are required.' }, { status: 400 });
    if (title.length > 120 || medium.length > 120 || dimensions.length > 100) return NextResponse.json({ error: 'One or more text fields are too long.' }, { status: 400 });

    const supabase = requireServiceRole();
    const extension = extensions[photo.type];
    uploadedPath = `${crypto.randomUUID()}.${extension}`;
    const bytes = Buffer.from(await photo.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from('paintings').upload(uploadedPath, bytes, {
      contentType: photo.type, cacheControl: '31536000', upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from('paintings').getPublicUrl(uploadedPath);
    const { data, error } = await supabase.from('paintings').insert({
      title, medium, dimensions, price: numeric.price, length_cm: numeric.length_cm,
      breadth_cm: numeric.breadth_cm, height_cm: numeric.height_cm, weight_kg: numeric.weight_kg,
      image_url: publicData.publicUrl, is_sold: false, is_approved: true, artist_id: null, artist_name: 'Artiste Studio',
    }).select('*').single();
    if (error) {
      await supabase.storage.from('paintings').remove([uploadedPath]);
      throw error;
    }
    return NextResponse.json({ painting: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Upload failed.' }, { status: 500 });
  }
}
