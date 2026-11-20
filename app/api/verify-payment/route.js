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
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.description || `Razorpay API returned HTTP ${response.status}.`);
  return data;
}

export async function POST(request) {
  let order = null;
  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await request.json();
    if (!orderId || !paymentId || !signature) return NextResponse.json({ error: 'Payment verification details are incomplete.' }, { status: 400 });
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not configured.');

    const supabase = requireServiceRole();
    const { data, error: orderError } = await supabase.from('orders').select('*').eq('razorpay_order_id', orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!data) return NextResponse.json({ error: 'Payment order was not found.' }, { status: 404 });
    order = data;

    if (!validSignature(orderId, paymentId, signature, secret)) return NextResponse.json({ error: 'Payment signature could not be verified.' }, { status: 400 });
    if (order.status === 'shipment_created' || order.status === 'paid') {
      return NextResponse.json({ ok: true, message: 'Your payment is confirmed. Your artwork order is being processed.' });
    }
    if (['payment_conflict', 'cancelled'].includes(order.status)) {
      return NextResponse.json({ error: 'This order needs manual review. Please contact the gallery with your payment ID.' }, { status: 409 });
    }

    // Verify the payment against Razorpay's server API as well as the checkout
    // HMAC. Auto-capture an authorised payment if account capture settings did
    // not capture it automatically.
    let payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== orderId || Number(payment.amount) !== Number(order.amount_paise)) {
      return NextResponse.json({ error: 'Payment details do not match this order.' }, { status: 400 });
    }
    if (payment.status === 'authorized') {
      payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: Number(order.amount_paise), currency: 'INR' });
    }
    if (payment.status !== 'captured') {
      return NextResponse.json({ error: `Payment is not captured yet (current status: ${payment.status || 'unknown'}).` }, { status: 409 });
    }

    // Reserve the one-off artwork with a conditional update. This protects
    // against two buyers paying for the same painting at nearly the same time.
    const { data: reserved, error: reserveError } = await supabase.from('paintings')
      .update({ is_sold: true }).eq('id', order.painting_id).eq('is_sold', false).select('id').maybeSingle();
    if (reserveError) throw reserveError;
    if (!reserved) {
      // A duplicate callback for this same order can arrive after the first
      // callback has already reserved the painting. Do not misclassify that
      // duplicate as a competing purchase or overwrite a paid order's status.
      const { data: latestOrder } = await supabase.from('orders').select('status').eq('id', order.id).maybeSingle();
      if (latestOrder && ['paid', 'shipment_created'].includes(latestOrder.status)) {
        return NextResponse.json({ ok: true, message: 'Your payment is confirmed. Your artwork order is being processed.' });
      }
      await supabase.from('orders').update({ status: 'payment_conflict', razorpay_payment_id: paymentId }).eq('id', order.id).eq('status', 'pending');
      return NextResponse.json({ error: 'Payment was captured, but this unique artwork was sold in another checkout. Please contact the gallery immediately for a refund.' }, { status: 409 });
    }

    const { error: paidUpdateError } = await supabase.from('orders').update({ status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() }).eq('id', order.id);
    if (paidUpdateError) throw paidUpdateError;

    const { data: painting, error: paintingError } = await supabase.from('paintings')
      .select('id,title,price,weight_kg,length_cm,breadth_cm,height_cm').eq('id', order.painting_id).single();
    if (paintingError) throw paintingError;

    try {
      const shipment = await createShiprocketShipment(order, painting);
      const shiprocketFields = {
        status: 'shipment_created',
        shiprocket_order_id: shipment.shiprocketOrderId ? String(shipment.shiprocketOrderId) : null,
        shiprocket_shipment_id: shipment.shipmentId ? String(shipment.shipmentId) : null,
        shiprocket_awb_code: shipment.awbCode,
        shipment_note: shipment.awbMessage || null,
      };
      const { error: shipmentUpdateError } = await supabase.from('orders').update(shiprocketFields).eq('id', order.id);
      if (shipmentUpdateError) throw shipmentUpdateError;
      return NextResponse.json({
        ok: true,
        shipmentCreated: Boolean(shipment.shipmentId),
        awbAssigned: Boolean(shipment.awbCode),
        message: shipment.awbMessage || 'Payment received. Your artwork is marked sold and your Shiprocket order has been created. Delivery updates will follow.',
      });
    } catch (shipmentError) {
      console.error('Payment captured, but Shiprocket fulfilment failed:', shipmentError.message);
      await supabase.from('orders').update({ status: 'paid', shipment_note: shipmentError.message }).eq('id', order.id);
      return NextResponse.json({ ok: true, shipmentCreated: false, message: 'Payment received and artwork reserved. Shipment creation needs a manual retry; the gallery has been alerted.' });
    }
  } catch (error) {
    console.error('Payment verification failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not verify payment.' }, { status: 500 });
  }
}
