import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';

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

export async function PATCH(request, { params }) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const { id } = await params;
    const body = await request.json();
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: existing, error: existingError } = await supabase.from('paintings').select('id,is_sold,stock_quantity').eq('id', id).eq('artist_id', artist.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: 'Artwork not found.' }, { status: 404 });
    const allowed = ['title', 'medium', 'dimensions', 'price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm', 'category', 'edition_details', 'print_details'];
    const update = {};
    for (const key of allowed) if (body[key] !== undefined) update[key] = body[key];
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
    if (existing.is_sold && Object.keys(update).some((key) => key !== 'stock_quantity' && key !== 'is_sold')) return NextResponse.json({ error: 'A sold-out listing can be restocked, but its details cannot be edited until it is available again.' }, { status: 409 });
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No changes supplied.' }, { status: 400 });
    for (const key of ['price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm']) {
      if (update[key] !== undefined && (!Number.isFinite(Number(update[key])) || Number(update[key]) <= 0)) return NextResponse.json({ error: `${key} must be a positive number.` }, { status: 400 });
    }
    if (update.weight_kg !== undefined && Number(update.weight_kg) < 0.2) return NextResponse.json({ error: 'Packed weight must be at least 0.2 kg.' }, { status: 400 });
    if (update.category !== undefined && !['Painting', 'Photography'].includes(update.category)) return NextResponse.json({ error: 'Choose Painting or Photography as the art form.' }, { status: 400 });
    if (['title', 'medium', 'dimensions'].some((key) => update[key] !== undefined && !String(update[key]).trim())) return NextResponse.json({ error: 'Text details cannot be blank.' }, { status: 400 });
    const { data, error } = await supabase.from('paintings').update(update).eq('id', id).eq('artist_id', artist.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ painting: data });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not update artwork.' }, { status: 400 }); }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const { id } = await params;
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: painting, error: readError } = await supabase.from('paintings').select('id,image_url').eq('id', id).eq('artist_id', artist.id).single();
    if (readError) throw readError;
    const { error } = await supabase.from('paintings').delete().eq('id', id).eq('artist_id', artist.id);
    if (error) throw error;
    const marker = '/storage/v1/object/public/paintings/';
    const pos = String(painting.image_url || '').indexOf(marker);
    if (pos >= 0) await supabase.storage.from('paintings').remove([decodeURIComponent(painting.image_url.slice(pos + marker.length))]);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not delete artwork.' }, { status: 400 }); }
}
