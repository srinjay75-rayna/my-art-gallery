import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.payout_status !== 'Pending') {
      return NextResponse.json({ error: 'Payment proof is mandatory. Use the payout proof settlement flow to record an Artist payment.' }, { status: 409 });
    }
    const supabase = requireServiceRole();
    const { data: existing, error: existingError } = await supabase.from('artist_payouts').select('id,payout_status,delivered_at,payout_available_at').eq('id', id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: 'Artist payout ledger entry not found.' }, { status: 404 });
    const { data, error } = await supabase.rpc('set_artiste_payout_status', {
      p_payout_id: id,
      p_status: body.payout_status,
    });
    if (error) throw error;
    const { data: payout, error: readError } = await supabase.from('artist_payouts').select('*').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!payout) return NextResponse.json({ error: 'Artist payout ledger entry not found.' }, { status: 404 });
    return NextResponse.json({ payout, result: data });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not update payout status.' }, { status: 400 });
  }
}
