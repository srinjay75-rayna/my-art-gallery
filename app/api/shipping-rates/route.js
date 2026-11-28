import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRatesByPickup, groupPaintingsByPickup } from '@/lib/shiprocket';
import { calculatePartnerPackingCharge } from '@/lib/packing';
import { getUserFromRequest } from '@/lib/auth-server';
import { calculatePhotographyGradePrices, getPrintLabCosts, photographyGrade } from '@/lib/photography-pricing';
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
    const gradeById = new Map(rawItems.map((item) => [String(item?.paintingId || item?.id || '').trim(), Number(item?.edition_grade || 1)]));
    const deliveryPincode = String(body.deliveryPincode || '').trim();
    const deliveryCity = String(body.deliveryCity || '').trim();
    const deliveryState = String(body.deliveryState || '').trim();
    if (!ids.length || ids.length > 20 || ids.some((id) => !/^[0-9a-f-]{20,40}$/i.test(id))) return NextResponse.json({ error: 'Your cart is empty or contains an invalid artwork.' }, { status: 400 });
    if (!/^\d{6}$/.test(deliveryPincode)) return NextResponse.json({ error: 'Enter a valid 6-digit delivery PIN code.' }, { status: 400 });

    const supabase = requireServiceRole();
    const { data: paintings, error } = await supabase.from('paintings')
      .select('id,title,price,weight_kg,length_cm,breadth_cm,height_cm,artist_id,artist_name,category,artist_fee_grade_1,print_lab_managed,is_sold,is_approved,stock_quantity,delivery_format,delivery_format_other,packing_mode')
      .in('id', ids).eq('is_sold', false).eq('is_approved', true).gt('stock_quantity', 0);
    if (error) throw error;
    if (!paintings || paintings.length !== ids.length) return NextResponse.json({ error: 'One or more artworks are sold or no longer available.' }, { status: 409 });

    const artistIds = [...new Set(paintings.map((painting) => painting.artist_id).filter(Boolean))];
    const [{ data: artists, error: artistError }, { data: accounts, error: accountError }, { data: legacyOrigins, error: originError }] = await Promise.all([
      artistIds.length ? supabase.from('artists').select('id,artist_name,creator_role,is_approved,pickup_pincode,pickup_location,city,state').in('id', artistIds) : Promise.resolve({ data: [], error: null }),
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
        const isPhotographerPrint = artist.creator_role === 'Photographer' && painting.category === 'Photography';
        if (isPhotographerPrint) {
          const grade = photographyGrade(gradeById.get(String(painting.id)));
          const printPin = String(process.env.PRINT_LAB_PICKUP_PIN || '').trim();
          if (!/^\d{6}$/.test(printPin)) throw new Error('PRINT_LAB_PICKUP_PIN must be configured as a valid 6-digit PIN code before photography checkout can continue.');
          const photographyPrice = calculatePhotographyGradePrices(painting.artist_fee_grade_1, getPrintLabCosts()).find((row) => row.grade === grade.grade);
          if (!photographyPrice) throw new Error(`The Photographer has not configured a valid Grade I artist fee for “${painting.title}”.`);
          return {
            ...painting,
            price: photographyPrice.collector_price,
            print_lab_managed: true,
            weight_kg: grade.package.weight,
            length_cm: grade.package.length_cm,
            breadth_cm: grade.package.breadth_cm,
            height_cm: grade.package.height_cm,
            artist_name: artist.artist_name,
            pickup_pincode: printPin,
            pickup_location: process.env.PRINT_LAB_PICKUP_LOCATION || 'Primary',
            pickup_city: process.env.PRINT_LAB_PICKUP_CITY || '',
            pickup_state: process.env.PRINT_LAB_PICKUP_STATE || '',
          };
        }
        return { ...painting, weight_kg: actualWeight, artist_name: artist.artist_name, pickup_pincode: artist.pickup_pincode, pickup_location: artist.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary', pickup_city: artist.city || '', pickup_state: artist.state || '' };
      }
      const origin = originMap.get(painting.id);
      return { ...painting, weight_kg: actualWeight, pickup_pincode: origin?.pickup_pincode || process.env.PICKUP_PINCODE, pickup_location: origin?.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary' };
    });

    const groupedItems = groupPaintingsByPickup(enriched);
    const groups = await getCourierRatesByPickup(enriched, deliveryPincode, { city: deliveryCity, state: deliveryState });
    const packingByGroup = new Map(groupedItems.map((group) => [group.groupKey, group.print_lab_managed ? 0 : group.items.reduce((sum, item) => sum + calculatePartnerPackingCharge(item), 0)]));
    const enrichedGroups = groups.map((group) => ({
      ...group,
      partnerPackingAmount: Math.round((packingByGroup.get(group.groupKey) || 0) * 100) / 100,
      hasPartnerPacking: (packingByGroup.get(group.groupKey) || 0) > 0,
    }));
    if (enrichedGroups.some((group) => !group.couriers.length)) {
      const unavailable = enrichedGroups.filter((group) => !group.couriers.length).map((group) => group.artistName);
      return NextResponse.json({ error: `No courier options are available from: ${unavailable.join(', ')}.`, groups: enrichedGroups }, { status: 409 });
    }
    return NextResponse.json({ groups: enrichedGroups, deliveryPincode, shippingTotal: enrichedGroups.reduce((sum, group) => sum + Math.min(...group.couriers.map((courier) => courier.rate)), 0), packingTotal: enrichedGroups.reduce((sum, group) => sum + group.partnerPackingAmount, 0) });
  } catch (error) {
    console.error('Shiprocket rates failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not fetch live courier rates.' }, { status: Number(error?.status) || (error?.message?.includes('sign in') ? 401 : 400) });
  }
}
