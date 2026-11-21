import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { createShiprocketShipment } from '@/lib/shiprocket';

export const runtime = 'nodejs';

function validSignature(orderId, paymentId, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(String(signature || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function razorpayFetch(path, method = 'GET', body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.description || `Razorpay API returned HTTP ${response.status}.`);
  return data;
}

export async function POST(request) {
  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await request.json();
    if (!orderId || !paymentId || !signature) return NextResponse.json({ error: 'Payment verification details are incomplete.' }, { status: 400 });
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !process.env.RAZORPAY_KEY_ID) throw new Error('Razorpay keys are not configured.');
    const supabase = requireServiceRole();
    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('razorpay_order_id', orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: 'Payment order was not found.' }, { status: 404 });
    if (!validSignature(orderId, paymentId, signature, secret)) return NextResponse.json({ error: 'Payment signature could not be verified.' }, { status: 400 });
    if (['shipment_created', 'paid'].includes(order.status)) return NextResponse.json({ ok: true, message: 'Payment confirmed. Your order is being processed.' });
    if (['payment_conflict', 'cancelled'].includes(order.status)) return NextResponse.json({ error: 'This order needs manual review. Please contact Artiste with your payment ID.' }, { status: 409 });

    let payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== orderId || Number(payment.amount) !== Number(order.amount_paise)) return NextResponse.json({ error: 'Payment details do not match this order.' }, { status: 400 });
    if (payment.status === 'authorized') payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: Number(order.amount_paise), currency: 'INR' });
    if (payment.status !== 'captured') return NextResponse.json({ error: `Payment is not captured yet (status: ${payment.status || 'unknown'}).` }, { status: 409 });

    const items = Array.isArray(order.items) ? order.items : [{ id: order.painting_id }];
    const ids = items.map((item) => String(item.id));
    let reserved = false;
    const { data: rpcResult, error: rpcError } = await supabase.rpc('reserve_paintings_for_order', { p_ids: ids });
    if (!rpcError) reserved = rpcResult === true;
    else {
      // Compatibility fallback for projects that have not yet run the latest SQL.
      const { data: rows } = await supabase.from('paintings').select('id,is_sold').in('id', ids);
      if (rows?.length === ids.length && rows.every((row) => !row.is_sold)) {
        let updatedAll = true;
        for (const id of ids) {
          const { data: updated, error } = await supabase.from('paintings').update({ is_sold: true }).eq('id', id).eq('is_sold', false).select('id').maybeSingle();
          if (error || !updated) { updatedAll = false; break; }
        }
        reserved = updatedAll;
      }
    }
    if (!reserved) {
      await supabase.from('orders').update({ status: 'payment_conflict', razorpay_payment_id: paymentId }).eq('id', order.id).eq('status', 'pending');
      return NextResponse.json({ error: 'Payment was captured, but one or more unique artworks are no longer available. Please contact Artiste immediately for a refund.' }, { status: 409 });
    }
    const { error: paidError } = await supabase.from('orders').update({ status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() }).eq('id', order.id);
    if (paidError) throw paidError;
    try {
      const shipment = await createShiprocketShipment(order);
      const { error: shipUpdateError } = await supabase.from('orders').update({
        status: 'shipment_created', shiprocket_order_id: shipment.shiprocketOrderId ? String(shipment.shiprocketOrderId) : null,
        shiprocket_shipment_id: shipment.shipmentId ? String(shipment.shipmentId) : null,
        shiprocket_awb_code: shipment.awbCode, shipment_note: shipment.awbMessage || null,
      }).eq('id', order.id);
      if (shipUpdateError) throw shipUpdateError;
      return NextResponse.json({ ok: true, shipmentCreated: Boolean(shipment.shipmentId), awbAssigned: Boolean(shipment.awbCode), message: shipment.awbMessage || 'Payment received. Your order has been placed and shipment creation was sent to Shiprocket.' });
    } catch (shipmentError) {
      console.error('Payment captured, but Shiprocket fulfilment failed:', shipmentError.message);
      await supabase.from('orders').update({ status: 'paid', shipment_note: shipmentError.message }).eq('id', order.id);
      return NextResponse.json({ ok: true, shipmentCreated: false, message: 'Payment received and artwork reserved. Shipping setup needs manual attention from the gallery.' });
    }
  } catch (error) {
    console.error('Payment verification failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not verify payment.' }, { status: 500 });
  }
}
