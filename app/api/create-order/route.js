import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRates, aggregatePackage } from '@/lib/shiprocket';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';

function validateBuyer(buyer) {
  if (!buyer || typeof buyer !== 'object') return 'Buyer details are required.';
  const required = ['name', 'email', 'phone', 'address', 'city', 'state', 'pincode'];
  for (const key of required) if (!String(buyer[key] || '').trim()) return `Please provide your ${key}.`;
  if (!/^\S+@\S+\.\S+$/.test(String(buyer.email))) return 'Enter a valid email address.';
  if (!/^\d{6}$/.test(String(buyer.pincode))) return 'Enter a valid 6-digit PIN code.';
  const phone = String(buyer.phone).replace(/[\s()+-]/g, '');
  if (!/^\d{10,13}$/.test(phone)) return 'Enter a valid phone number.';
  if (String(buyer.name).length > 100 || String(buyer.address).length > 250 || String(buyer.city).length > 80 || String(buyer.state).length > 80) return 'One or more buyer details are too long.';
  return null;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const buyer = body.buyer;
    const buyerError = validateBuyer(buyer);
    const ids = Array.isArray(body.items) ? [...new Set(body.items.map((item) => String(item.paintingId || item.id || '')))] : [String(body.paintingId || '')];
    const courierId = Number(body.courierId);
    if (buyerError || !ids.length || ids.some((id) => !id) || !Number.isInteger(courierId)) {
      return NextResponse.json({ error: buyerError || 'Your cart or courier selection is invalid.' }, { status: 400 });
    }
    const supabase = requireServiceRole();
    const user = await getUserFromRequest(request, { optional: true });
    const { data: paintings, error: paintingError } = await supabase.from('paintings')
      .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,is_approved,artist_id,artist_name')
      .in('id', ids).eq('is_sold', false).eq('is_approved', true);
    if (paintingError) throw paintingError;
    if (!paintings || paintings.length !== ids.length) return NextResponse.json({ error: 'One or more artworks have already sold or are unavailable.' }, { status: 409 });

    const couriers = await getCourierRates({ paintings, deliveryPincode: String(buyer.pincode) });
    const courier = couriers.find((item) => item.courier_company_id === courierId);
    if (!courier) return NextResponse.json({ error: 'That courier quote has expired. Refresh delivery options and choose again.' }, { status: 409 });
    if (Number.isFinite(Number(body.quotedRate)) && Math.abs(Number(body.quotedRate) - Number(courier.rate)) > 0.01) {
      return NextResponse.json({ error: 'The courier price changed. Please refresh shipping rates and confirm the updated total.' }, { status: 409 });
    }
    const artworkPrice = paintings.reduce((sum, item) => sum + Number(item.price), 0);
    const shippingPrice = Number(courier.rate);
    const amountPaise = Math.round((artworkPrice + shippingPrice) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000) return NextResponse.json({ error: 'The payable amount is invalid.' }, { status: 400 });
    const packageData = aggregatePackage(paintings);
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay keys are missing from the server environment.');
    const merchantRef = `AR${Date.now()}${crypto.randomInt(1000, 9999)}`.slice(0, 20);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: merchantRef, notes: { painting_ids: ids.join(','), item_count: String(ids.length) } }), cache: 'no-store',
    });
    const razorpayOrder = await razorpayResponse.json().catch(() => ({}));
    if (!razorpayResponse.ok || !razorpayOrder.id) throw new Error(razorpayOrder.error?.description || 'Razorpay could not create the payment order.');
    const first = paintings[0];
    const orderItems = paintings.map((p) => ({
      id: p.id, title: p.title, medium: p.medium, dimensions: p.dimensions,
      price: Number(p.price), image_url: p.image_url, artist_name: p.artist_name,
      weight_kg: Number(p.weight_kg), length_cm: Number(p.length_cm), breadth_cm: Number(p.breadth_cm), height_cm: Number(p.height_cm),
    }));
    const { error: insertError } = await supabase.from('orders').insert({
      merchant_order_ref: merchantRef, user_id: user?.id || null,
      painting_id: String(first.id), painting_title: paintings.map((p) => p.title).join(', '), items: orderItems,
      buyer_name: String(buyer.name).trim(), buyer_email: String(buyer.email).trim().toLowerCase(),
      buyer_phone: String(buyer.phone).trim(), buyer_address: String(buyer.address).trim(),
      buyer_city: String(buyer.city).trim(), buyer_state: String(buyer.state).trim(), buyer_pincode: String(buyer.pincode),
      artwork_price: artworkPrice, shipping_price: shippingPrice, amount_paise: amountPaise, currency: 'INR',
      courier_id: courier.courier_company_id, courier_name: courier.courier_name,
      razorpay_order_id: razorpayOrder.id, status: 'pending',
      package_weight_kg: packageData.weight, package_length_cm: packageData.length_cm,
      package_breadth_cm: packageData.breadth_cm, package_height_cm: packageData.height_cm,
    });
    if (insertError) throw insertError;
    if (user) {
      await supabase.from('profiles').upsert({ id: user.id, full_name: String(buyer.name).trim(), phone: String(buyer.phone).trim(), address: String(buyer.address).trim(), city: String(buyer.city).trim(), state: String(buyer.state).trim(), pincode: String(buyer.pincode) });
    }
    return NextResponse.json({ orderId: razorpayOrder.id, amount: amountPaise, currency: 'INR', keyId, courier: { name: courier.courier_name, rate: shippingPrice }, items: orderItems });
  } catch (error) {
    console.error('Create payment order failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not create payment order.' }, { status: 500 });
  }
}
