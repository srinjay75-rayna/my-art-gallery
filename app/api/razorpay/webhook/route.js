import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { processCapturedOrder } from '@/lib/order-processing';

export const runtime = 'nodejs';

function safeEqualHex(leftText, rightText) {
  if (!/^[0-9a-f]{64}$/i.test(String(leftText || '')) || !/^[0-9a-f]{64}$/i.test(String(rightText || ''))) return false;
  const left = Buffer.from(String(leftText), 'hex');
  const right = Buffer.from(String(rightText), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function POST(request) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured.');
    const rawBody = await request.text();
    const suppliedSignature = request.headers.get('x-razorpay-signature') || '';
    const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqualHex(suppliedSignature, expectedSignature)) return NextResponse.json({ error: 'Invalid Razorpay webhook signature.' }, { status: 401 });

    const event = JSON.parse(rawBody);
    if (event.event !== 'payment.captured') return NextResponse.json({ received: true, ignored: true });
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) return NextResponse.json({ error: 'Captured payment payload is incomplete.' }, { status: 400 });

    const supabase = requireServiceRole();
    const { data: order, error } = await supabase.from('orders').select('*').eq('razorpay_order_id', payment.order_id).maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: 'The corresponding Artiste order was not found.' }, { status: 404 });
    if (Number(payment.amount) !== Number(order.amount_paise) || String(payment.currency || 'INR') !== 'INR') {
      return NextResponse.json({ error: 'Captured payment amount or currency does not match the Artiste order.' }, { status: 409 });
    }
    if (order.razorpay_payment_id && order.razorpay_payment_id !== payment.id) return NextResponse.json({ error: 'A different payment has already been recorded for this order.' }, { status: 409 });

    const result = await processCapturedOrder({ order, paymentId: payment.id });
    if (result.needsManualReview) return NextResponse.json({ received: true, needsManualReview: true });
    return NextResponse.json({ received: true, paid: true, shipmentCreated: result.shipmentCreated });
  } catch (error) {
    console.error('Razorpay webhook processing failed:', error.message);
    // 5xx asks Razorpay to retry transient DB/Shiprocket failures. Per-shipment claims prevent overlapping calls.
    return NextResponse.json({ error: error.message || 'Webhook processing failed.' }, { status: 500 });
  }
}
