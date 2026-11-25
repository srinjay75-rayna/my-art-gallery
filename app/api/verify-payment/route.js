import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { processCapturedOrder } from '@/lib/order-processing';

export const runtime = 'nodejs';

function validSignature(orderId, paymentId, signature, secret) {
  if (!/^[0-9a-f]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function razorpayFetch(path, method = 'GET', body) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay keys are not configured.');
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.description || `Razorpay API returned HTTP ${response.status}.`);
  return data;
}

export async function POST(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const body = await request.json();
    const orderId = String(body.razorpay_order_id || '');
    const paymentId = String(body.razorpay_payment_id || '');
    const signature = String(body.razorpay_signature || '');
    if (!orderId || !paymentId || !signature) return NextResponse.json({ error: 'Payment verification details are incomplete.' }, { status: 400 });
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !process.env.RAZORPAY_KEY_ID) throw new Error('Razorpay keys are not configured.');
    if (!validSignature(orderId, paymentId, signature, secret)) return NextResponse.json({ error: 'Payment signature could not be verified.' }, { status: 400 });

    const supabase = requireServiceRole();
    const { data: order, error } = await supabase.from('orders').select('*').eq('razorpay_order_id', orderId).maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: 'Payment order was not found.' }, { status: 404 });
    if (String(order.user_id) !== String(user.id)) return NextResponse.json({ error: 'This payment order does not belong to the signed-in Customer.' }, { status: 403 });
    if (['Payment conflict', 'Cancelled', 'Setup failed'].includes(order.status)) return NextResponse.json({ error: 'This order needs manual review. Please contact Artiste with your payment ID.' }, { status: 409 });
    if (order.razorpay_payment_id && order.razorpay_payment_id !== paymentId) return NextResponse.json({ error: 'A different payment has already been recorded for this order.' }, { status: 409 });

    // Razorpay settles artwork, courier delivery and separately listed insured studio packing.
    const artworkAmount = Number(order.artwork_price || 0);
    const courierShipping = Number(order.shipping_amount ?? order.shipping_price ?? 0);
    const insuredPacking = Number(order.insured_packing_amount || 0);
    const expectedTotalPaise = Math.round((artworkAmount + courierShipping + insuredPacking) * 100);
    const savedTotalPaise = Math.round(Number(order.total_amount ?? (Number(order.amount_paise || 0) / 100)) * 100);
    if (!Number.isSafeInteger(expectedTotalPaise) || !Number.isSafeInteger(savedTotalPaise) || expectedTotalPaise !== Number(order.amount_paise) || savedTotalPaise !== Number(order.amount_paise)) {
      return NextResponse.json({ error: 'The saved artwork and courier total does not match its Razorpay amount. Please contact Artiste support before retrying.' }, { status: 409 });
    }

    let payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== orderId || Number(payment.amount) !== Number(order.amount_paise) || String(payment.currency || 'INR') !== 'INR') {
      return NextResponse.json({ error: 'Payment details do not match this order.' }, { status: 400 });
    }
    if (payment.status === 'authorized') payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: Number(order.amount_paise), currency: 'INR' });
    if (payment.status !== 'captured') return NextResponse.json({ error: `Payment is not captured yet (status: ${payment.status || 'unknown'}).` }, { status: 409 });

    const result = await processCapturedOrder({ order, paymentId });
    if (result.needsManualReview) {
      return NextResponse.json({
        ok: true,
        paid: false,
        needsManualReview: true,
        message: result.message,
      }, { status: 202 });
    }

    // The database trigger assigns ART-YYYY-00001 when the order transitions
    // to Paid. This RPC is an idempotent safety net for older paid records.
    const { data: billNumber, error: billError } = await supabase.rpc(
      'ensure_artiste_bill_number',
      { p_order_id: order.id }
    );

    if (billError || !billNumber) {
      console.error('Sequential Bill of Supply assignment failed:', billError?.message || 'No bill number returned.');
      return NextResponse.json({
        ok: true,
        paid: true,
        shipmentCreated: result.shipmentCreated,
        billNumber: null,
        billWarning: 'Payment was verified. The official Bill Number is being prepared; refresh My Orders shortly.',
        message: result.message,
      }, { status: 200 });
    }

    return NextResponse.json({
      ok: true,
      paid: true,
      billNumber,
      shipmentCreated: result.shipmentCreated,
      message: result.message,
    });
  } catch (error) {
    console.error('Payment verification failed:', error.message);
    return NextResponse.json({ error: error.message || 'Payment verification failed.' }, { status: 400 });
  }
}
