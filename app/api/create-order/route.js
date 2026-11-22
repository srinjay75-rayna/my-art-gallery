import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRatesByPickup, groupPaintingsByPickup } from '@/lib/shiprocket';
import { getUserFromRequest } from '@/lib/auth-server';
import { normaliseIndianPhone } from '@/lib/india-address';

export const runtime = 'nodejs';
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

function validateProfile(profile) {
  if (!profile) return 'Save your Customer shipping details before checkout.';
  const required = ['full_name', 'phone', 'address', 'landmark', 'locality', 'city', 'state', 'pincode'];
  for (const key of required) if (!String(profile[key] || '').trim()) return `Please complete your ${key.replaceAll('_', ' ')} in My Details before checkout.`;
  if (!/^\d{6}$/.test(String(profile.pincode))) return 'Enter a valid 6-digit delivery PIN code in My Details.';
  if (!/^\d{10}$/.test(normaliseIndianPhone(profile.phone))) return 'Enter a valid 10-digit +91 mobile number in My Details.';
  return null;
}

async function createRazorpayOrder({ keyId, keySecret, amountPaise, merchantRef, ids }) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: merchantRef,
      notes: { painting_ids: ids.join(','), item_count: String(ids.length) },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(data.error?.description || 'Razorpay could not create the payment order.');
  return data;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const ids = Array.isArray(body.items)
      ? [...new Set(body.items.map((item) => String(item.paintingId || item.id || '').trim()))]
      : [String(body.paintingId || '').trim()];
    if (!ids.length || ids.length > 20 || ids.some((id) => !/^[0-9a-f-]{20,40}$/i.test(id))) {
      return NextResponse.json({ error: 'Your cart is empty or contains an invalid artwork.' }, { status: 400 });
    }

    const supabase = requireServiceRole();
    const [{ data: profile, error: profileError }, { data: paintings, error: paintingError }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('paintings')
        .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,is_approved,stock_quantity,artist_id,artist_name,category,edition_details,print_details')
        .in('id', ids).eq('is_sold', false).gt('stock_quantity', 0).eq('is_approved', true),
    ]);
    if (profileError) throw profileError;
    if (paintingError) throw paintingError;
    const profileErrorText = validateProfile(profile);
    if (profileErrorText) return NextResponse.json({ error: profileErrorText }, { status: 400 });
    if (!paintings || paintings.length !== ids.length) return NextResponse.json({ error: 'One or more artworks have already sold or are unavailable.' }, { status: 409 });

    // Resolve each work's private pickup origin from the Artist profile or migrated legacy-origin table.
    const artistIds = [...new Set(paintings.map((painting) => painting.artist_id).filter(Boolean))];
    const paintingIds = paintings.map((painting) => painting.id);
    const [{ data: artists, error: artistsError }, { data: payoutAccounts, error: payoutError }, { data: legacyOrigins, error: originError }] = await Promise.all([
      artistIds.length ? supabase.from('artists').select('id,user_id,artist_name,creator_role,is_approved,pickup_contact_name,pickup_phone,pickup_address,pickup_landmark,pickup_locality,city,state,pickup_pincode,pickup_location').in('id', artistIds) : Promise.resolve({ data: [], error: null }),
      artistIds.length ? supabase.from('artist_payout_accounts').select('artist_id,account_holder_name,bank_account_number_encrypted,bank_account_number_masked,ifsc_code,bank_name,branch_name,upi_id,verified_at').in('artist_id', artistIds) : Promise.resolve({ data: [], error: null }),
      supabase.from('painting_shipping_origins').select('painting_id,pickup_pincode,pickup_location').in('painting_id', paintingIds),
    ]);
    if (artistsError) throw artistsError;
    if (payoutError) throw payoutError;
    if (originError) throw originError;

    const artistMap = new Map((artists || []).map((artist) => [artist.id, artist]));
    const payoutMap = new Map((payoutAccounts || []).map((account) => [account.artist_id, account]));
    const originMap = new Map((legacyOrigins || []).map((origin) => [origin.painting_id, origin]));

    const enrichedPaintings = paintings.map((painting) => {
      if (painting.artist_id) {
        const artist = artistMap.get(painting.artist_id);
        if (!artist || !artist.is_approved) throw new Error(`The Artist profile for “${painting.title}” is not currently approved.`);
        const payout = payoutMap.get(painting.artist_id);
        if (!payout?.verified_at) throw new Error(`The Artist “${artist.artist_name}” must complete verified payout details before their artwork can be purchased. Please contact Artiste support.`);
        if (!/^\d{6}$/.test(String(artist.pickup_pincode || ''))) throw new Error(`The Artist “${artist.artist_name}” has not completed a valid pickup PIN code.`);
        return {
          ...painting,
          artist_name: artist.artist_name,
          creator_role: artist.creator_role || 'Painter',
          pickup_pincode: artist.pickup_pincode,
          pickup_location: artist.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
          dispatchSnapshot: {
            artist_id: artist.id,
            artist_name: artist.artist_name,
            creator_role: artist.creator_role || 'Painter',
            pickup_contact_name: artist.pickup_contact_name,
            pickup_phone: artist.pickup_phone,
            pickup_address: artist.pickup_address,
            pickup_landmark: artist.pickup_landmark,
            pickup_locality: artist.pickup_locality,
            pickup_city: artist.city,
            pickup_state: artist.state,
            pickup_pincode: artist.pickup_pincode,
            pickup_location: artist.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
            payout_info: {
              account_holder_name: payout.account_holder_name,
              bank_account_number_encrypted: payout.bank_account_number_encrypted,
              bank_account_number_masked: payout.bank_account_number_masked,
              ifsc_code: payout.ifsc_code,
              bank_name: payout.bank_name,
              branch_name: payout.branch_name,
              upi_id: payout.upi_id,
              verified_at: payout.verified_at,
            },
          },
        };
      }
      const legacy = originMap.get(painting.id);
      const pickupPincode = legacy?.pickup_pincode || process.env.PICKUP_PINCODE || '';
      const pickupLocation = legacy?.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
      if (!/^\d{6}$/.test(String(pickupPincode))) throw new Error(`No valid pickup PIN code is configured for “${painting.title}”.`);
      return { ...painting, creator_role: 'Painter', artist_name: painting.artist_name || 'Artiste Studio', pickup_pincode: pickupPincode, pickup_location: pickupLocation, dispatchSnapshot: { artist_id: null, artist_name: 'Artiste Studio', pickup_pincode: pickupPincode, pickup_location: pickupLocation, payout_info: null } };
    });

    const groups = groupPaintingsByPickup(enrichedPaintings);
    const liveRateGroups = await getCourierRatesByPickup(enrichedPaintings, String(profile.pincode));
    const requestedSelections = Array.isArray(body.couriers) ? body.couriers : [];
    if (requestedSelections.length !== groups.length) return NextResponse.json({ error: 'Select one live courier for every Artist pickup location.' }, { status: 400 });

    const shipmentRows = [];
    let shippingAmount = 0;
    for (const group of groups) {
      const available = liveRateGroups.find((rateGroup) => rateGroup.groupKey === group.groupKey);
      const selected = requestedSelections.find((choice) => choice.groupKey === group.groupKey);
      if (!available?.couriers?.length) return NextResponse.json({ error: `No courier or local collection option is available from ${group.artist_name}'s studio. Please contact Artiste support.` }, { status: 409 });
      const courier = available.couriers.find((option) => option.courier_company_id === Number(selected?.courierId));
      if (!courier) return NextResponse.json({ error: `The delivery quote for ${group.artist_name} has expired. Refresh delivery options and choose again.` }, { status: 409 });
      if (!Number.isFinite(Number(selected?.quotedRate)) || Math.abs(Number(selected.quotedRate) - courier.rate) > 0.01) {
        return NextResponse.json({ error: `The courier price for ${group.artist_name} has changed. Refresh shipping rates.` }, { status: 409 });
      }
      shippingAmount = money(shippingAmount + courier.rate);
      const snapshot = group.items[0].dispatchSnapshot || {};
      shipmentRows.push({
        group_key: group.groupKey,
        group_index: group.groupIndex,
        artist_id: group.artist_id,
        artist_name: group.artist_name,
        pickup_contact_name: snapshot.pickup_contact_name || '',
        pickup_phone: snapshot.pickup_phone || '',
        pickup_address: snapshot.pickup_address || '',
        pickup_landmark: snapshot.pickup_landmark || '',
        pickup_locality: snapshot.pickup_locality || '',
        pickup_city: snapshot.pickup_city || '',
        pickup_state: snapshot.pickup_state || '',
        pickup_pincode: group.pickupPincode,
        pickup_location: group.pickupLocation,
        payout_info: snapshot.payout_info || {},
        items: group.items.map((item) => ({ id: item.id, title: item.title, price: money(item.price), weight_kg: Number(item.weight_kg), length_cm: Number(item.length_cm), breadth_cm: Number(item.breadth_cm), height_cm: Number(item.height_cm) })),
        package_weight_kg: group.package.weight,
        package_length_cm: group.package.length_cm,
        package_breadth_cm: group.package.breadth_cm,
        package_height_cm: group.package.height_cm,
        courier_id: courier.courier_company_id,
        courier_name: courier.courier_name,
        shipping_amount: money(courier.rate),
        shipment_status: 'Pending',
        shipment_note: null,
      });
    }

    const artworkPrice = money(enrichedPaintings.reduce((sum, item) => sum + Number(item.price), 0));
    const orderItems = enrichedPaintings.map((painting) => {
      const price = money(painting.price);
      const creatorRole = painting.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      const commissionRate = creatorRole === 'Photographer' ? 0.05 : 0.02;
      const platformFee = money(price * commissionRate);
      return {
        id: painting.id,
        title: painting.title,
        medium: painting.medium,
        dimensions: painting.dimensions,
        price,
        platform_fee: platformFee,
        artist_payout: money(price - platformFee),
        image_url: painting.image_url,
        artist_id: painting.artist_id,
        artist_name: painting.artist_name || 'Artiste Studio',
        creator_role: creatorRole,
        commission_rate: commissionRate,
        category: painting.category || 'Painting',
        edition_details: painting.edition_details || '',
        print_details: painting.print_details || '',
        quantity: 1,
      };
    });
    const platformFee = money(orderItems.reduce((sum, item) => sum + item.platform_fee, 0));
    const artistPayout = money(orderItems.reduce((sum, item) => sum + item.artist_payout, 0));
    const totalAmount = money(artworkPrice + shippingAmount);
    const amountPaise = Math.round(totalAmount * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000) return NextResponse.json({ error: 'The payable amount is invalid.' }, { status: 400 });

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay keys are missing from the server environment.');
    const merchantRef = `AR${Date.now()}${crypto.randomInt(1000, 9999)}`.slice(0, 20);
    const razorpayOrder = await createRazorpayOrder({ keyId, keySecret, amountPaise, merchantRef, ids });

    const customerName = String(profile.full_name).trim();
    const customerEmail = String(user.email || '').trim().toLowerCase();
    const customerPhone = `+91${normaliseIndianPhone(profile.phone)}`;
    const primaryShipment = shipmentRows[0];
    const orderRow = {
      merchant_order_ref: merchantRef,
      user_id: user.id,
      painting_id: String(enrichedPaintings[0].id),
      painting_title: enrichedPaintings.map((painting) => painting.title).join(', '),
      items: orderItems,
      buyer_name: customerName,
      buyer_email: customerEmail,
      buyer_phone: customerPhone,
      buyer_address: String(profile.address).trim(),
      buyer_city: profile.city,
      buyer_state: profile.state,
      buyer_pincode: profile.pincode,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      shipping_address: String(profile.address).trim(),
      landmark: String(profile.landmark).trim(),
      locality: String(profile.locality).trim(),
      city: profile.city,
      state: profile.state,
      pincode: profile.pincode,
      artwork_price: artworkPrice,
      shipping_price: shippingAmount,
      shipping_amount: shippingAmount,
      total_amount: totalAmount,
      platform_fee: platformFee,
      artist_payout: artistPayout,
      payout_status: 'Pending',
      amount_paise: amountPaise,
      currency: 'INR',
      courier_id: primaryShipment.courier_id,
      courier_name: shipmentRows.length > 1 ? `Multiple couriers (${shipmentRows.length} Artist studios)` : primaryShipment.courier_name,
      razorpay_order_id: razorpayOrder.id,
      status: 'Pending',
      shipment_status: 'Pending',
      pickup_pincode: shipmentRows.length === 1 ? primaryShipment.pickup_pincode : '',
      pickup_location: shipmentRows.length === 1 ? primaryShipment.pickup_location : 'Multiple',
      package_weight_kg: shipmentRows.length === 1 ? primaryShipment.package_weight_kg : null,
      package_length_cm: shipmentRows.length === 1 ? primaryShipment.package_length_cm : null,
      package_breadth_cm: shipmentRows.length === 1 ? primaryShipment.package_breadth_cm : null,
      package_height_cm: shipmentRows.length === 1 ? primaryShipment.package_height_cm : null,
    };

    const { data: savedOrder, error: insertError } = await supabase.from('orders').insert(orderRow).select('id').single();
    if (insertError) throw new Error(`Razorpay order was created, but Artiste could not save the pending order: ${insertError.message}. Please do not retry payment; contact support with reference ${merchantRef}.`);
    const rowsToInsert = shipmentRows.map((row) => ({ ...row, order_id: savedOrder.id }));
    const { error: shipmentsError } = await supabase.from('order_shipments').insert(rowsToInsert);
    if (shipmentsError) {
      await supabase.from('orders').update({ status: 'Setup failed', shipment_status: 'Needs owner review', shipment_note: `Dispatch records could not be saved: ${shipmentsError.message}` }).eq('id', savedOrder.id);
      throw new Error(`Artiste saved the order but could not prepare its dispatch records (${merchantRef}). Contact support before paying.`);
    }

    return NextResponse.json({
      orderId: razorpayOrder.id,
      amount: amountPaise,
      currency: 'INR',
      keyId,
      artworkPrice,
      shippingAmount,
      totalAmount,
      shipmentCount: shipmentRows.length,
    });
  } catch (error) {
    console.error('Create payment order failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not create payment order.' }, { status: 400 });
  }
}
