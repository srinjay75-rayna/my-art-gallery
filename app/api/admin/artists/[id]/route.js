import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function PATCH(request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const supabase = requireServiceRole();
    if (typeof body.is_founding_artist === 'boolean' && body.is_approved === undefined) {
      const { data: artist, error } = await supabase.from('artists').update({ is_founding_artist: body.is_founding_artist }).eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ artist });
    }
    if (typeof body.is_approved !== 'boolean') return NextResponse.json({ error: 'Provide is_approved or is_founding_artist as a boolean.' }, { status: 400 });
    const { data: artist, error } = await supabase.from('artists').update({
      approved: body.is_approved,
      is_approved: body.is_approved,
      is_suspended: !body.is_approved,
    }).eq('id', id).select('*').single();
    if (error) throw error;
    const { error: paintingsError } = await supabase.from('paintings').update({ is_approved: body.is_approved }).eq('artist_id', id).eq('is_sold', false);
    if (paintingsError) throw paintingsError;
    return NextResponse.json({ artist });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not update artist.' }, { status: 400 }); }
}

export async function DELETE(_request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const supabase = requireServiceRole();
    const [{ data: paintings, error: paintingsReadError }, { data: artist, error: artistReadError }, { data: payoutRows, error: payoutReadError }] = await Promise.all([
      supabase.from('paintings').select('id,image_url,gallery_images,is_sold').eq('artist_id', id),
      supabase.from('artists').select('profile_photo_url,avatar_url').eq('id', id).maybeSingle(),
      supabase.from('artist_payouts').select('id').eq('artist_id', id).limit(1),
    ]);
    if (paintingsReadError) throw paintingsReadError;
    if (artistReadError) throw artistReadError;
    if (payoutReadError) throw payoutReadError;
    if (!artist) return NextResponse.json({ error: 'Artist profile not found.' }, { status: 404 });
    if ((payoutRows || []).length || (paintings || []).some((painting) => painting.is_sold)) {
      return NextResponse.json({ error: 'This Artist has historical sales or payout records. Suspend the profile instead of deleting it so order and earnings history remain intact.' }, { status: 409 });
    }
    const paintingMarker = '/storage/v1/object/public/paintings/';
    const paintingPaths = [...new Set((paintings || []).flatMap((painting) => {
      const urls = [painting.image_url, ...(Array.isArray(painting.gallery_images) ? painting.gallery_images.map((image) => typeof image === 'string' ? image : image?.url) : [])].filter(Boolean);
      return urls.map((url) => {
        const pos = String(url).indexOf(paintingMarker);
        return pos >= 0 ? decodeURIComponent(String(url).slice(pos + paintingMarker.length)) : null;
      }).filter(Boolean);
    }))];
    if (paintingPaths.length) await supabase.storage.from('paintings').remove(paintingPaths);
    const { error: paintingDeleteError } = await supabase.from('paintings').delete().eq('artist_id', id);
    if (paintingDeleteError) throw paintingDeleteError;
    const { error } = await supabase.from('artists').delete().eq('id', id);
    if (error) throw error;
    const profileMarker = '/storage/v1/object/public/artist-profiles/';
    const profileImageUrl = artist?.avatar_url || artist?.profile_photo_url || '';
    const profilePos = String(profileImageUrl).indexOf(profileMarker);
    if (profilePos >= 0) await supabase.storage.from('artist-profiles').remove([decodeURIComponent(profileImageUrl.slice(profilePos + profileMarker.length))]);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not delete artist.' }, { status: 400 }); }
}
