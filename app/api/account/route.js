import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    const supabase = requireServiceRole();
    const [{ data: profile, error: profileError }, { data: orders, error: ordersError }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,phone,address,city,state,pincode').eq('id', user.id).maybeSingle(),
      supabase.from('orders').select('id,merchant_order_ref,painting_title,items,artwork_price,shipping_price,amount_paise,courier_name,shiprocket_awb_code,shiprocket_order_id,status,shipment_note,created_at,paid_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    ]);
    if (profileError) throw profileError;
    if (ordersError) throw ordersError;
    return NextResponse.json({ user: { id: user.id, email: user.email }, profile, orders: orders || [] });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not load your account.' }, { status: 401 }); }
}

export async function PATCH(request) {
  try {
    const user = await getUserFromRequest(request);
    const body = await request.json();
    const profile = {
      id: user.id, full_name: String(body.full_name || '').trim(), phone: String(body.phone || '').trim(),
      address: String(body.address || '').trim(), city: String(body.city || '').trim(),
      state: String(body.state || '').trim(), pincode: String(body.pincode || '').trim(),
    };
    if (!profile.full_name || !profile.phone || !profile.address || !profile.city || !profile.state || !/^\d{6}$/.test(profile.pincode)) {
      return NextResponse.json({ error: 'Please complete all details and enter a valid 6-digit PIN code.' }, { status: 400 });
    }
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('profiles').upsert(profile).select('id,full_name,phone,address,city,state,pincode').single();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not save your details.' }, { status: 400 }); }
}
