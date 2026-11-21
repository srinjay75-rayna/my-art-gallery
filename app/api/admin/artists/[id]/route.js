import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function PATCH(request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    if (typeof body.is_approved !== 'boolean') return NextResponse.json({ error: 'is_approved must be true or false.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: artist, error } = await supabase.from('artists').update({ is_approved: body.is_approved }).eq('id', id).select('*').single();
    if (error) throw error;
    if (!body.is_approved) {
      const { error: paintingsError } = await supabase.from('paintings').update({ is_approved: false }).eq('artist_id', id).eq('is_sold', false);
      if (paintingsError) throw paintingsError;
    }
    return NextResponse.json({ artist });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not update artist.' }, { status: 400 }); }
}

export async function DELETE(_request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const supabase = requireServiceRole();
    const [{ data: paintings, error: paintingsReadError }, { data: artist, error: artistReadError }, { data: payoutRows, error: payoutReadError }] = await Promise.all([
      supabase.from('paintings').select('id,image_url,is_sold').eq('artist_id', id),
      supabase.from('artists').select('profile_photo_url').eq('id', id).maybeSingle(),
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
    const paintingPaths = (paintings || []).map((p) => {
      const pos = String(p.image_url || '').indexOf(paintingMarker);
      return pos >= 0 ? decodeURIComponent(p.image_url.slice(pos + paintingMarker.length)) : null;
    }).filter(Boolean);
    if (paintingPaths.length) await supabase.storage.from('paintings').remove(paintingPaths);
    const { error: paintingDeleteError } = await supabase.from('paintings').delete().eq('artist_id', id);
    if (paintingDeleteError) throw paintingDeleteError;
    const { error } = await supabase.from('artists').delete().eq('id', id);
    if (error) throw error;
    const profileMarker = '/storage/v1/object/public/artist-profiles/';
    const profilePos = String(artist?.profile_photo_url || '').indexOf(profileMarker);
    if (profilePos >= 0) await supabase.storage.from('artist-profiles').remove([decodeURIComponent(artist.profile_photo_url.slice(profilePos + profileMarker.length))]);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not delete artist.' }, { status: 400 }); }
}
