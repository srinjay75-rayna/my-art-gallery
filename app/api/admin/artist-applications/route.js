import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('artist_applications').select('*').in('application_status', ['Pending', 'Submitted']).order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ applications: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load applications.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id, decision } = await request.json();
    if (!id || !['approve', 'decline'].includes(decision)) return NextResponse.json({ error: 'A valid application and decision are required.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: application, error: findError } = await supabase.from('artist_applications').select('id, artist_id, application_status').eq('id', id).maybeSingle();
    if (findError) throw findError;
    if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    if (!['Pending', 'Submitted'].includes(application.application_status)) return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 });
    const now = new Date().toISOString();
    const status = decision === 'approve' ? 'Approved' : 'Declined';
    const { error: appError } = await supabase.from('artist_applications').update({ application_status: status, updated_at: now }).eq('id', id);
    if (appError) throw appError;
    if (decision === 'approve') {
      const { error: artistError } = await supabase.from('artists').update({ is_founding_artist: true, updated_at: now }).eq('id', application.artist_id);
      if (artistError) throw artistError;
    }
    return NextResponse.json({ success: true, status, message: decision === 'approve' ? 'Approved as Founding Artist with 80% share.' : 'Application declined.' });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not review application.' }, { status: 400 });
  }
}
