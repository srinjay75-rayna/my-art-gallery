import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const paintingId = String(new URL(request.url).searchParams.get('paintingId') || '').trim();
    if (!/^[0-9a-f-]{20,40}$/i.test(paintingId)) return NextResponse.json({ error: 'A valid artwork ID is required.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('photography_editions').select('grade,edition_limit,sold_count').eq('painting_id', paintingId).order('grade');
    if (error) throw error;
    return NextResponse.json({ editions: data || [] }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load edition availability.' }, { status: 500 });
  }
}
