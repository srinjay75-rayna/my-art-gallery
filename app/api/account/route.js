import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { normaliseIndianPhone } from '@/lib/india-address';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const supabase = requireServiceRole();
    const email = String(user.email || '').trim().toLowerCase();
    const emailPattern = email.replace(/[\\%_]/g, '\\$&');
    const [{ data: profile, error: profileError }, { data: byUser, error: userOrdersError }, { data: byCustomerEmail, error: customerEmailError }, { data: byLegacyEmail, error: legacyEmailError }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,phone,address,landmark,locality,city,state,pincode,created_at,updated_at').eq('id', user.id).maybeSingle(),
      supabase.from('orders').select('id,merchant_order_ref,bill_number,painting_title,items,artwork_price,shipping_amount,total_amount,amount_paise,courier_name,shiprocket_awb_code,shiprocket_order_id,shiprocket_shipment_id,status,shipment_status,shipment_note,created_at,paid_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      email ? supabase.from('orders').select('id,merchant_order_ref,bill_number,painting_title,items,artwork_price,shipping_amount,total_amount,amount_paise,courier_name,shiprocket_awb_code,shiprocket_order_id,shiprocket_shipment_id,status,shipment_status,shipment_note,created_at,paid_at').ilike('customer_email', emailPattern).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      email ? supabase.from('orders').select('id,merchant_order_ref,bill_number,painting_title,items,artwork_price,shipping_amount,total_amount,amount_paise,courier_name,shiprocket_awb_code,shiprocket_order_id,shiprocket_shipment_id,status,shipment_status,shipment_note,created_at,paid_at').ilike('buyer_email', emailPattern).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileError) throw profileError;
    if (userOrdersError) throw userOrdersError;
    if (customerEmailError) throw customerEmailError;
    if (legacyEmailError) throw legacyEmailError;

    const map = new Map();
    for (const order of [...(byUser || []), ...(byCustomerEmail || []), ...(byLegacyEmail || [])]) map.set(order.id, order);
    const orders = [...map.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const orderIds = orders.map((order) => order.id);
    const shipmentsByOrder = new Map();
    if (orderIds.length) {
      const { data: shipments, error: shipmentError } = await supabase.from('order_shipments')
        .select('id,order_id,artist_name,courier_name,shiprocket_order_id,shiprocket_shipment_id,awb_code,shipment_status,shipment_note,pickup_contact_name,pickup_phone,pickup_address,pickup_landmark,pickup_locality,pickup_city,pickup_state,pickup_pincode,pickup_location,created_at')
        .in('order_id', orderIds).order('group_index', { ascending: true });
      if (shipmentError) throw shipmentError;
      const paidOrderIds = new Set(orders.filter((row) => String(row.status || '').toLowerCase() === 'paid').map((row) => row.id));
      for (const shipment of shipments || []) {
        const rows = shipmentsByOrder.get(shipment.order_id) || [];
        const showCollectionDetails = paidOrderIds.has(shipment.order_id) && shipment.shipment_status === 'Studio pickup selected';
        rows.push({
          artist_name: shipment.artist_name,
          courier_name: shipment.courier_name,
          shiprocket_order_id: shipment.shiprocket_order_id,
          shiprocket_shipment_id: shipment.shiprocket_shipment_id,
          awb_code: shipment.awb_code,
          shipment_status: shipment.shipment_status,
          shipment_note: shipment.shipment_note,
          pickup_contact_name: showCollectionDetails ? shipment.pickup_contact_name : null,
          pickup_phone: showCollectionDetails ? shipment.pickup_phone : null,
          pickup_address: showCollectionDetails ? shipment.pickup_address : null,
          pickup_landmark: showCollectionDetails ? shipment.pickup_landmark : null,
          pickup_locality: showCollectionDetails ? shipment.pickup_locality : null,
          pickup_city: showCollectionDetails ? shipment.pickup_city : null,
          pickup_state: showCollectionDetails ? shipment.pickup_state : null,
          pickup_pincode: showCollectionDetails ? shipment.pickup_pincode : null,
          pickup_location: showCollectionDetails ? shipment.pickup_location : null,
        });
        shipmentsByOrder.set(shipment.order_id, rows);
      }
    }

    const customerOrders = orders.map((order) => ({
      ...order,
      shipments: shipmentsByOrder.get(order.id) || [],
      items: Array.isArray(order.items) ? order.items.map((item) => ({
        id: item.id, title: item.title, medium: item.medium, dimensions: item.dimensions,
        price: item.price, image_url: item.image_url, artist_name: item.artist_name,
      })) : [],
    }));
    return NextResponse.json({ user: { id: user.id, email }, profile, orders: customerOrders });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load your account.' }, { status: 401 });
  }
}

export async function PATCH(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const body = await request.json();
    const profile = {
      id: user.id,
      full_name: String(body.full_name || '').trim(),
      phone: `+91${normaliseIndianPhone(body.phone)}`,
      address: String(body.address || '').trim(),
      landmark: String(body.landmark || '').trim(),
      locality: String(body.locality || '').trim(),
      city: String(body.city || '').trim(),
      state: String(body.state || '').trim(),
      pincode: String(body.pincode || '').trim(),
      updated_at: new Date().toISOString(),
    };
    if (!profile.full_name || !/^\+91\d{10}$/.test(profile.phone) || !profile.address || !profile.landmark || !profile.locality || !profile.city || !profile.state || !/^\d{6}$/.test(profile.pincode)) {
      return NextResponse.json({ error: 'Complete your name, +91 mobile number, street address, landmark, locality, city, State / UT and valid 6-digit PIN code.' }, { status: 400 });
    }
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('profiles').upsert(profile).select('id,full_name,phone,address,landmark,locality,city,state,pincode,updated_at').single();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save your details.' }, { status: 400 });
  }
}
