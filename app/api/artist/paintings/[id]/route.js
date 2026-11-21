import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest, getArtistForUser } from '@/lib/auth-server';

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const { id } = await params;
    const body = await request.json();
    const supabase = requireServiceRole();
    const artist = await getArtistForUser(supabase, user.id);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: existing, error: existingError } = await supabase.from('paintings').select('id,is_sold').eq('id', id).eq('artist_id', artist.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: 'Artwork not found.' }, { status: 404 });
    if (existing.is_sold) return NextResponse.json({ error: 'Sold artworks cannot be edited.' }, { status: 409 });
    const allowed = ['title', 'medium', 'dimensions', 'price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm'];
    const update = {};
    for (const key of allowed) if (body[key] !== undefined) update[key] = body[key];
    if (body.is_sold !== undefined) {
      if (body.is_sold !== true) return NextResponse.json({ error: 'Artists may mark available works as sold, but only the owner can reverse a sold status.' }, { status: 403 });
      update.is_sold = true;
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No changes supplied.' }, { status: 400 });
    for (const key of ['price', 'weight_kg', 'length_cm', 'breadth_cm', 'height_cm']) {
      if (update[key] !== undefined && (!Number.isFinite(Number(update[key])) || Number(update[key]) <= 0)) return NextResponse.json({ error: `${key} must be a positive number.` }, { status: 400 });
    }
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
    const artist = await getArtistForUser(supabase, user.id);
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if (artist.is_suspended) return NextResponse.json({ error: 'Your Artist account is suspended by the Artiste owner.' }, { status: 403 });
    const { data: painting, error: readError } = await supabase.from('paintings').select('id,image_url,is_sold').eq('id', id).eq('artist_id', artist.id).single();
    if (readError) throw readError;
    if (painting.is_sold) return NextResponse.json({ error: 'Sold artworks cannot be deleted.' }, { status: 409 });
    const { error } = await supabase.from('paintings').delete().eq('id', id).eq('artist_id', artist.id);
    if (error) throw error;
    const marker = '/storage/v1/object/public/paintings/';
    const pos = String(painting.image_url || '').indexOf(marker);
    if (pos >= 0) await supabase.storage.from('paintings').remove([decodeURIComponent(painting.image_url.slice(pos + marker.length))]);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not delete artwork.' }, { status: 400 }); }
}
