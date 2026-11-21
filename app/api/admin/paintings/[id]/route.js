import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';

function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/paintings/';
  const index = String(url).indexOf(marker);
  return index >= 0 ? decodeURIComponent(String(url).slice(index + marker.length)) : null;
}

export async function PATCH(request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    if (typeof body.is_sold !== 'boolean' && typeof body.is_approved !== 'boolean') return NextResponse.json({ error: 'Provide is_sold or is_approved.' }, { status: 400 });
    const update = {};
    if (typeof body.is_sold === 'boolean') update.is_sold = body.is_sold;
    if (typeof body.is_approved === 'boolean') update.is_approved = body.is_approved;
    const supabase = requireServiceRole();
    if (body.is_approved === true) {
      const { data: existing, error: existingError } = await supabase.from('paintings').select('artist_id').eq('id', id).single();
      if (existingError) throw existingError;
      if (existing.artist_id) {
        const { data: artist, error: artistError } = await supabase.from('artists').select('is_suspended').eq('id', existing.artist_id).maybeSingle();
        if (artistError) throw artistError;
        if (artist?.is_suspended) return NextResponse.json({ error: 'This Artist is suspended. Reactivate the Artist before publishing their artwork.' }, { status: 409 });
      }
    }
    const { data, error } = await supabase.from('paintings').update(update).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ painting: data });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Update failed.' }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const supabase = requireServiceRole();
    const { data: painting, error: readError } = await supabase.from('paintings').select('id,image_url').eq('id', id).single();
    if (readError) throw readError;
    const { error } = await supabase.from('paintings').delete().eq('id', id);
    if (error) throw error;
    const path = storagePathFromPublicUrl(painting.image_url);
    if (path) {
      const { error: storageError } = await supabase.storage.from('paintings').remove([path]);
      if (storageError) console.error('Painting row deleted, but image cleanup failed:', storageError.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Delete failed.' }, { status: 500 });
  }
}
