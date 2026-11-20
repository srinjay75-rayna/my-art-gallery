import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRates } from '@/lib/shiprocket';

export const runtime = 'nodejs';

function validateBuyer(buyer) {
  if (!buyer || typeof buyer !== 'object') return 'Buyer details are required.';
  const required = ['name', 'email', 'phone', 'address', 'city', 'state', 'pincode'];
  for (const key of required) if (!String(buyer[key] || '').trim()) return `Please provide your ${key}.`;
  if (!/^\S+@\S+\.\S+$/.test(String(buyer.email))) return 'Enter a valid email address.';
  if (!/^\d{6}$/.test(String(buyer.pincode))) return 'Enter a valid 6-digit PIN code.';
  const phone = String(buyer.phone).replace(/[\s()+-]/g, '');
  if (!/^\d{10,13}$/.test(phone)) return 'Enter a valid phone number with 10 to 13 digits.';
  if (String(buyer.name).length > 100 || String(buyer.address).length > 250 || String(buyer.city).length > 80 || String(buyer.state).length > 80) return 'One or more buyer details are too long.';
  return null;
}

export async function POST(request) {
  try {
    const { paintingId, buyer, courierId } = await request.json();
    const buyerError = validateBuyer(buyer);
    if (buyerError || !paintingId || !Number.isInteger(Number(courierId))) {
      return NextResponse.json({ error: buyerError || 'Select a valid courier.' }, { status: 400 });
    }

    const supabase = requireServiceRole();
    const { data: painting, error: paintingError } = await supabase.from('paintings')
      .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold')
      .eq('id', paintingId).eq('is_sold', false).maybeSingle();
    if (paintingError) throw paintingError;
    if (!painting) return NextResponse.json({ error: 'This painting has already been sold or is unavailable.' }, { status: 409 });

    // Never trust the price supplied by the browser: ask Shiprocket again and
    // match the selected courier against a fresh server-side quote.
    const couriers = await getCourierRates({ painting, deliveryPincode: String(buyer.pincode) });
    const courier = couriers.find((item) => item.courier_company_id === Number(courierId));
    if (!courier) return NextResponse.json({ error: 'That courier quote has expired or is no longer available. Please refresh delivery options.' }, { status: 409 });

    const artworkPrice = Number(painting.price);
    const shippingPrice = Number(courier.rate);
    const amountPaise = Math.round((artworkPrice + shippingPrice) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000) {
      return NextResponse.json({ error: 'The payable amount is invalid. Please contact the gallery.' }, { status: 400 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay keys are missing from the server environment.');
    const merchantRef = `RG${Date.now()}${crypto.randomInt(1000, 9999)}`.slice(0, 20);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: merchantRef, notes: { painting_id: String(painting.id), painting_title: painting.title } }),
      cache: 'no-store',
    });
    const razorpayOrder = await razorpayResponse.json().catch(() => ({}));
    if (!razorpayResponse.ok || !razorpayOrder.id) throw new Error(razorpayOrder.error?.description || 'Razorpay could not create the payment order.');

    const { error: insertError } = await supabase.from('orders').insert({
      merchant_order_ref: merchantRef,
      painting_id: String(painting.id), painting_title: painting.title,
      buyer_name: String(buyer.name).trim(), buyer_email: String(buyer.email).trim().toLowerCase(),
      buyer_phone: String(buyer.phone).trim(), buyer_address: String(buyer.address).trim(),
      buyer_city: String(buyer.city).trim(), buyer_state: String(buyer.state).trim(), buyer_pincode: String(buyer.pincode),
      artwork_price: artworkPrice, shipping_price: shippingPrice, amount_paise: amountPaise,
      currency: 'INR', courier_id: courier.courier_company_id, courier_name: courier.courier_name,
      razorpay_order_id: razorpayOrder.id, status: 'pending',
    });
    if (insertError) throw insertError;

    return NextResponse.json({ orderId: razorpayOrder.id, amount: amountPaise, currency: 'INR', keyId, courier: { name: courier.courier_name, rate: shippingPrice }, painting: { id: painting.id, title: painting.title } });
  } catch (error) {
    console.error('Create payment order failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not create payment order.' }, { status: 500 });
  }
}
