import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';
import { sendPartnerWhatsAppDispatch } from '@/lib/packer-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId || '').trim();
    if (!/^[0-9a-f-]{20,40}$/i.test(orderId)) return NextResponse.json({ error: 'Choose a valid paid order.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).eq('status', 'Paid').maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: 'Paid order not found.' }, { status: 404 });
    const result = await sendPartnerWhatsAppDispatch(supabase, order);
    return NextResponse.json(result, { status: result.sent || result.alreadySent ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not send packing dispatch.' }, { status: 500 });
  }
}
