import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRatesByPickup } from '@/lib/shiprocket';
import { getUserFromRequest } from '@/lib/auth-server';
import { enforceRateLimit, rateLimitJsonResponse, readJsonBody } from '@/lib/request-guard';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const rate = await enforceRateLimit(request, { scope: `shipping-rates:${user.id}`, limit: 24, windowSeconds: 5 * 60 });
    if (!rate.allowed) return rateLimitJsonResponse(NextResponse, rate, 'You have requested delivery quotes too frequently. Please try again in a few minutes.');
    const body = await readJsonBody(request, 16 * 1024);
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 21) : [];
    const ids = [...new Set(rawItems.map((item) => String(item?.paintingId || item?.id || '').trim()))];
    const deliveryPincode = String(body.deliveryPincode || '').trim();
    const deliveryCity = String(body.deliveryCity || '').trim();
    const deliveryState = String(body.deliveryState || '').trim();
    if (!ids.length || ids.length > 20 || ids.some((id) => !/^[0-9a-f-]{20,40}$/i.test(id))) return NextResponse.json({ error: 'Your cart is empty or contains an invalid artwork.' }, { status: 400 });
    if (!/^\d{6}$/.test(deliveryPincode)) return NextResponse.json({ error: 'Enter a valid 6-digit delivery PIN code.' }, { status: 400 });

    const supabase = requireServiceRole();
    const { data: paintings, error } = await supabase.from('paintings')
      .select('id,title,price,weight_kg,length_cm,breadth_cm,height_cm,artist_id,artist_name,is_sold,is_approved,stock_quantity')
      .in('id', ids).eq('is_sold', false).eq('is_approved', true).gt('stock_quantity', 0);
    if (error) throw error;
    if (!paintings || paintings.length !== ids.length) return NextResponse.json({ error: 'One or more artworks are sold or no longer available.' }, { status: 409 });

    const artistIds = [...new Set(paintings.map((painting) => painting.artist_id).filter(Boolean))];
    const [{ data: artists, error: artistError }, { data: accounts, error: accountError }, { data: legacyOrigins, error: originError }] = await Promise.all([
      artistIds.length ? supabase.from('artists').select('id,artist_name,is_approved,pickup_pincode,pickup_location,city,state').in('id', artistIds) : Promise.resolve({ data: [], error: null }),
      artistIds.length ? supabase.from('artist_payout_accounts').select('artist_id,verified_at').in('artist_id', artistIds) : Promise.resolve({ data: [], error: null }),
      supabase.from('painting_shipping_origins').select('painting_id,pickup_pincode,pickup_location').in('painting_id', ids),
    ]);
    if (artistError) throw artistError;
    if (accountError) throw accountError;
    if (originError) throw originError;
    const artistMap = new Map((artists || []).map((artist) => [artist.id, artist]));
    const accountMap = new Map((accounts || []).map((account) => [account.artist_id, account]));
    const originMap = new Map((legacyOrigins || []).map((origin) => [origin.painting_id, origin]));

    const enriched = paintings.map((painting) => {
      const parsedWeight = painting.weight_kg === null || painting.weight_kg === undefined || painting.weight_kg === '' ? NaN : Number(painting.weight_kg);
      const actualWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0.5;
      if (painting.artist_id) {
        const artist = artistMap.get(painting.artist_id);
        if (!artist?.is_approved) throw new Error(`The Artist profile for “${painting.title}” is not approved.`);
        if (!accountMap.get(painting.artist_id)?.verified_at) throw new Error(`The Artist “${artist.artist_name}” must complete verified payout details before checkout.`);
        return { ...painting, weight_kg: actualWeight, artist_name: artist.artist_name, pickup_pincode: artist.pickup_pincode, pickup_location: artist.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary', pickup_city: artist.city || '', pickup_state: artist.state || '' };
      }
      const origin = originMap.get(painting.id);
      return { ...painting, weight_kg: actualWeight, pickup_pincode: origin?.pickup_pincode || process.env.PICKUP_PINCODE, pickup_location: origin?.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary' };
    });

    const groups = await getCourierRatesByPickup(enriched, deliveryPincode, { city: deliveryCity, state: deliveryState });
    if (groups.some((group) => !group.couriers.length)) {
      const unavailable = groups.filter((group) => !group.couriers.length).map((group) => group.artistName);
      return NextResponse.json({ error: `No courier options are available from: ${unavailable.join(', ')}.`, groups }, { status: 409 });
    }
    return NextResponse.json({ groups, deliveryPincode, shippingTotal: groups.reduce((sum, group) => sum + Math.min(...group.couriers.map((courier) => courier.rate)), 0) });
  } catch (error) {
    console.error('Shiprocket rates failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not fetch live courier rates.' }, { status: Number(error?.status) || (error?.message?.includes('sign in') ? 401 : 400) });
  }
}
