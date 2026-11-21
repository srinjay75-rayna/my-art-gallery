import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { processCapturedOrder } from '@/lib/order-processing';
import { shiprocketRequest } from '@/lib/shiprocket';

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

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');
const clip = (value, max) => String(value || '').trim().slice(0, max);

function isAlreadyRegisteredPickupError(error) {
  const message = String(error?.message || error || '');
  return /already\s+(?:exists?|added|registered|present)|(?:pickup|location).{0,50}(?:exists?|duplicate)/i.test(message);
}

async function lookupPickupCoordinates(artist) {
  // Shiprocket's add-pickup API documents latitude and longitude as required.
  // Resolve only the postal area (PIN / city / state), never the full street
  // address, so a third-party geocoder does not receive the Artist's house or
  // studio-level address details. If lookup fails, caller uses Primary.
  const params = new URLSearchParams({
    postalcode: String(artist.pickup_pincode || ''),
    city: String(artist.city || ''),
    state: String(artist.state || ''),
    country: 'India',
    format: 'jsonv2',
    limit: '1',
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      'User-Agent': 'ArtisteMarketplace/1.0 (support@artiste-gallery.in)',
      'Accept-Language': 'en',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Pickup postal-area geocoding returned HTTP ${response.status}.`);
  const results = await response.json().catch(() => []);
  const first = Array.isArray(results) ? results[0] : null;
  const lat = Number(first?.lat);
  const long = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) throw new Error('Could not resolve pickup postal-area coordinates.');
  return { lat, long };
}

/**
 * Add the Artist's private studio as a Shiprocket pickup address.
 * Shiprocket's documented endpoint is:
 * POST https://apiv2.shiprocket.in/v1/external/settings/company/addpickup
 *
 * The pickup nickname is deterministic per Artist. If Shiprocket reports that
 * the nickname already exists, it is treated as success and reused. Any other
 * validation/API failure returns to the caller, which stores `Primary` instead.
 */
async function ensureArtistPickupLocation(artist, profilePhone) {
  const artistIdPrefix = String(artist?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
  if (!artistIdPrefix) throw new Error('Artist ID is unavailable for pickup-location registration.');

  const pickupLocation = `ARTIST_${artistIdPrefix}`;
  const name = clip(artist.pickup_contact_name || artist.artist_name, 80);
  const email = clip(artist.email, 120).toLowerCase();
  // The artists table stores the studio contact as pickup_phone. If it is
  // blank, use the phone saved in the Artist's own profile row.
  const phone = digitsOnly(artist.pickup_phone || profilePhone).slice(-10);
  const address = clip(artist.pickup_address, 80);
  const city = clip(artist.city, 60);
  const state = clip(artist.state, 60);
  const pinCode = String(artist.pickup_pincode || '').trim();
  const address2 = clip([artist.pickup_landmark, artist.pickup_locality].filter(Boolean).join(', '), 100);

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{10}$/.test(phone) || !address || !city || !state || !/^\d{6}$/.test(pinCode)) {
    throw new Error('Artist pickup profile is incomplete; using the Primary Shiprocket pickup location.');
  }

  const coordinates = await lookupPickupCoordinates(artist);

  try {
    await shiprocketRequest('/settings/company/addpickup', {
      method: 'POST',
      body: JSON.stringify({
        pickup_location: pickupLocation,
        name,
        email,
        phone,
        address,
        ...(address2 ? { address_2: address2 } : {}),
        city,
        state,
        country: 'India',
        pin_code: pinCode,
        lat: coordinates.lat,
        long: coordinates.long,
      }),
    });
  } catch (error) {
    // The deterministic code is already registered in this Shiprocket account.
    // Reusing it is safe; all other errors trigger the Primary fallback.
    if (!isAlreadyRegisteredPickupError(error)) throw error;
  }

  return pickupLocation;
}

/**
 * Refresh each unpaid-to-Shiprocket shipment row from the authoritative Artist
 * profile before order creation. `createShiprocketShipment()` subsequently
 * passes this exact stored `pickup_location` to /orders/create/adhoc.
 */
async function prepareArtistPickupLocations(supabase, orderId) {
  const { data: shipmentRows, error: shipmentError } = await supabase
    .from('order_shipments')
    .select('id,artist_id,courier_id,shiprocket_order_id,shiprocket_shipment_id,pickup_location')
    .eq('order_id', orderId)
    .order('group_index', { ascending: true });
  if (shipmentError) throw new Error(`Could not load Artist dispatch records: ${shipmentError.message}`);
  if (!shipmentRows?.length) return;

  // Local hand-off and studio collection rows never go to Shiprocket.
  const pendingCourierRows = shipmentRows.filter((row) =>
    !row.shiprocket_order_id && !row.shiprocket_shipment_id && Number(row.courier_id) > 0
  );
  if (!pendingCourierRows.length) return;

  const artistIds = [...new Set(pendingCourierRows.map((row) => row.artist_id).filter(Boolean))];
  let artistRows = [];
  let artistLookupFailed = false;
  if (artistIds.length) {
    const { data, error } = await supabase
      .from('artists')
      .select('id,user_id,email,artist_name,pickup_contact_name,pickup_phone,pickup_address,pickup_landmark,pickup_locality,city,state,pickup_pincode')
      .in('id', artistIds);
    if (error) {
      console.error('Artist pickup profile lookup failed; using Primary:', error.message);
      artistLookupFailed = true;
    } else {
      artistRows = data || [];
    }
  }

  const artistMap = new Map(artistRows.map((artist) => [String(artist.id), artist]));
  const userIds = [...new Set(artistRows.map((artist) => artist.user_id).filter(Boolean))];
  let phoneByUserId = new Map();
  if (userIds.length) {
    const { data: profiles, error } = await supabase.from('profiles').select('id,phone').in('id', userIds);
    if (error) {
      // Artist.pickup_phone remains the primary source; a profile lookup failure
      // must not prevent a purchase from being recorded.
      console.error('Artist profile phone fallback lookup failed:', error.message);
    } else {
      phoneByUserId = new Map((profiles || []).map((profile) => [String(profile.id), profile.phone]));
    }
  }

  for (const row of pendingCourierRows) {
    const artist = artistMap.get(String(row.artist_id || ''));
    let pickupLocation = 'Primary';
    let patch = { pickup_location: 'Primary' };

    if (artist && !artistLookupFailed) {
      const profilePhone = phoneByUserId.get(String(artist.user_id || '')) || '';
      const phone = digitsOnly(artist.pickup_phone || profilePhone).slice(-10);
      // Keep the dispatch snapshot current with the values read from `artists`.
      patch = {
        artist_name: artist.artist_name || 'Artiste Studio',
        pickup_contact_name: artist.pickup_contact_name || artist.artist_name || '',
        pickup_phone: phone,
        pickup_address: artist.pickup_address || '',
        pickup_landmark: artist.pickup_landmark || '',
        pickup_locality: artist.pickup_locality || '',
        pickup_city: artist.city || '',
        pickup_state: artist.state || '',
        pickup_pincode: artist.pickup_pincode || '',
        pickup_location: 'Primary',
      };
      try {
        pickupLocation = await ensureArtistPickupLocation(artist, profilePhone);
      } catch (error) {
        console.error(`Could not register Shiprocket pickup location for Artist ${artist.id}; using Primary:`, error.message);
      }
      patch.pickup_location = pickupLocation;
    } else if (row.artist_id) {
      console.error(`Artist ${row.artist_id} was unavailable; using Primary Shiprocket pickup location.`);
    }

    const { error: updateError } = await supabase.from('order_shipments').update(patch).eq('id', row.id);
    if (updateError) {
      // If the full snapshot update fails, at least try to persist the required
      // fallback. If even that fails we stop, rather than shipping from a stale
      // or unintended pickup location.
      const { error: fallbackError } = await supabase
        .from('order_shipments')
        .update({ pickup_location: 'Primary' })
        .eq('id', row.id);
      if (fallbackError) {
        throw new Error(`Could not save the Artist pickup location or Primary fallback: ${fallbackError.message}`);
      }
      console.error('Could not refresh Artist dispatch snapshot; persisted Primary fallback:', updateError.message);
    }
  }
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

    let payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== orderId || Number(payment.amount) !== Number(order.amount_paise) || String(payment.currency || 'INR') !== 'INR') {
      return NextResponse.json({ error: 'Payment details do not match this order.' }, { status: 400 });
    }
    if (payment.status === 'authorized') payment = await razorpayFetch(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: Number(order.amount_paise), currency: 'INR' });
    if (payment.status !== 'captured') return NextResponse.json({ error: `Payment is not captured yet (status: ${payment.status || 'unknown'}).` }, { status: 409 });

    // Register / reuse each Artist's Shiprocket pickup nickname before the
    // paid-order fulfilment routine creates its /orders/create/adhoc payload.
    await prepareArtistPickupLocations(supabase, order.id);

    const result = await processCapturedOrder({ order, paymentId });
    if (result.needsManualReview) return NextResponse.json({ ok: true, paid: false, needsManualReview: true, message: result.message }, { status: 202 });
    return NextResponse.json({ ok: true, paid: true, shipmentCreated: result.shipmentCreated, message: result.message });
  } catch (error) {
    console.error('Payment verification failed:', error.message);
    return NextResponse.json({ error: error.message || 'Payment verification failed.' }, { status: 400 });
  }
}
