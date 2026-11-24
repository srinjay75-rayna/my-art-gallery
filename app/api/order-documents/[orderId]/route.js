import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { isAdminRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { orderId } = await params;
    if (!orderId || !/^[0-9a-f-]{20,40}$/i.test(String(orderId))) {
      return NextResponse.json({ error: 'Invalid order reference.' }, { status: 400 });
    }

    const documentMode = new URL(request.url).searchParams.get('mode') || 'invoice';
    const owner = await isAdminRequest();
    let user = null;
    if (!owner) user = await getUserFromRequest(request);
    if (!owner && !user) return NextResponse.json({ error: 'Sign in to view this order document.' }, { status: 401 });

    const supabase = requireServiceRole();
    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (String(order.status || '').toLowerCase() !== 'paid') {
      return NextResponse.json({ error: 'The official Bill of Supply is available after payment is confirmed as Paid.' }, { status: 409 });
    }

    let billNumber = order.bill_number || null;
    if (!/^ART-\d{4}-\d{5,}$/.test(String(billNumber || ''))) {
      const { data: generatedBill, error: billError } = await supabase.rpc(
        'ensure_artiste_bill_number',
        { p_order_id: orderId }
      );
      if (billError || !generatedBill) {
        console.error('Could not ensure sequential Bill of Supply:', billError?.message || 'No serial bill returned.');
        return NextResponse.json({
          error: 'This paid order does not yet have its sequential Bill of Supply number. Run database/schema.sql and try again.',
        }, { status: 503 });
      }
      billNumber = generatedBill;
    }

    let role = owner ? 'owner' : 'customer';
    let artistId = null;
    let artistNameForRequest = '';
    if (!owner) {
      const email = String(user.email || '').trim().toLowerCase();
      const userType = user.user_metadata?.account_type;
      if (userType === 'artist') {
        role = 'artist';
        const creatorRole = user.user_metadata?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
        let { data: artist, error: artistError } = await supabase.from('artists').select('id,artist_name').eq('user_id', user.id).eq('creator_role', creatorRole).maybeSingle();
        if (!artist && creatorRole === 'Painter' && !artistError) {
          const legacyArtist = await supabase.from('artists').select('id,artist_name').eq('user_id', user.id).is('creator_role', null).maybeSingle();
          artist = legacyArtist.data || null;
          artistError = legacyArtist.error;
        }
        if (artistError) throw artistError;
        artistId = artist?.id || null;
        const artistName = String(artist?.artist_name || '').trim().toLowerCase();
        artistNameForRequest = artistName;
        if (documentMode !== 'packing-slip') return NextResponse.json({ error: 'Official customer Bills of Supply are available to the purchasing Customer and Artiste owner.' }, { status: 403 });
        const [{ data: payoutRows, error: payoutError }, { data: shipmentRowsForArtist, error: shipmentError }] = await Promise.all([
          artistId ? supabase.from('artist_payouts').select('id').eq('order_id', orderId).eq('artist_id', artistId).limit(1) : Promise.resolve({ data: [], error: null }),
          artistId ? supabase.from('order_shipments').select('id').eq('order_id', orderId).eq('artist_id', artistId).limit(1) : Promise.resolve({ data: [], error: null }),
        ]);
        if (payoutError) throw payoutError;
        if (shipmentError) throw shipmentError;
        const lineItemAccess = (Array.isArray(order.items) ? order.items : []).some((item) => String(item.artist_id || '') === String(artistId || '') || (!item.artist_id && artistName && String(item.artist_name || '').trim().toLowerCase() === artistName));
        if (!artistId || (!lineItemAccess && !payoutRows?.length && !shipmentRowsForArtist?.length)) {
          return NextResponse.json({ error: 'This order is not associated with your Artist studio.' }, { status: 403 });
        }
      } else {
        const ownedById = String(order.user_id || '') === String(user.id);
        const emailMatch = email && email === String(order.customer_email || order.buyer_email || '').trim().toLowerCase();
        if (!ownedById && !emailMatch) return NextResponse.json({ error: 'This order does not belong to your Customer account.' }, { status: 403 });
      }
    }

    let shipmentQuery = supabase.from('order_shipments').select('id,artist_id,artist_name,pickup_contact_name,pickup_phone,pickup_address,pickup_landmark,pickup_locality,pickup_city,pickup_state,pickup_pincode,pickup_location,package_weight_kg,package_length_cm,package_breadth_cm,package_height_cm,courier_name,shipping_amount,shiprocket_order_id,shiprocket_shipment_id,awb_code,shipment_status,shipment_note,items,group_index').eq('order_id', orderId).order('group_index', { ascending: true });
    if (role === 'artist') shipmentQuery = shipmentQuery.eq('artist_id', artistId);
    const { data: shipments, error: shipmentReadError } = await shipmentQuery;
    if (shipmentReadError) throw shipmentReadError;

    const storedItems = Array.isArray(order.items) ? order.items : [];
    const safeItems = storedItems.length ? storedItems.map((item) => ({
      id: item.id,
      title: item.title || item.painting_title || 'Original artwork',
      category: item.category || 'Painting',
      creator_role: item.creator_role || 'Painter',
      edition_details: item.edition_details || '',
      print_details: item.print_details || '',
      archival_print_requested: Boolean(item.archival_print_requested),
      framed_status: item.framed_status || 'Unframed',
      certificate_id: item.certificate_id || '',
      description: item.description || '',
      quantity: Number(item.quantity || 1),
      medium: item.medium || '',
      dimensions: item.dimensions || '',
      price: Number(item.price ?? item.unit_price ?? 0),
      artist_id: item.artist_id || null,
      artist_name: item.artist_name || 'Artiste Studio',
      image_url: item.image_url || '',
    })) : (order.painting_id || order.painting_title ? [{
      id: order.painting_id || order.id,
      title: order.painting_title || 'Original artwork',
      medium: '',
      dimensions: '',
      price: Number(order.artwork_price || 0),
      artist_id: null,
      artist_name: 'Artiste Studio',
      image_url: '',
    }] : []);

    const shipmentsForDisplay = shipments || [];
    const computedArtworkAmount = Number(order.artwork_price || 0) || safeItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const computedShippingAmount = Number(order.shipping_amount || order.shipping_price || 0) || shipmentsForDisplay.reduce((sum, row) => sum + Number(row.shipping_amount || 0), 0);
    const computedTotalAmount = Number(order.total_amount || 0) || Number(order.amount_paise || 0) / 100 || (computedArtworkAmount + computedShippingAmount);

    const safeOrder = {
      id: order.id,
      merchant_order_ref: order.merchant_order_ref,
      bill_number: billNumber,
      created_at: order.created_at,
      paid_at: order.paid_at,
      status: order.status,
      razorpay_payment_id: order.razorpay_payment_id,
      customer_name: order.customer_name || order.buyer_name || '',
      customer_email: order.customer_email || order.buyer_email || '',
      customer_phone: order.customer_phone || order.buyer_phone || '',
      shipping_address: order.shipping_address || order.buyer_address || '',
      landmark: order.landmark || '',
      locality: order.locality || '',
      city: order.city || order.buyer_city || '',
      state: order.state || order.buyer_state || '',
      pincode: order.pincode || order.buyer_pincode || '',
      artwork_price: computedArtworkAmount,
      shipping_amount: computedShippingAmount,
      total_amount: computedTotalAmount,
      courier_name: order.courier_name || '',
      shipments: (shipments || []).map((row) => ({
        id: row.id,
        artist_id: row.artist_id,
        artist_name: row.artist_name,
        pickup_contact_name: row.pickup_contact_name,
        pickup_phone: row.pickup_phone,
        pickup_address: row.pickup_address,
        pickup_landmark: row.pickup_landmark,
        pickup_locality: row.pickup_locality,
        pickup_city: row.pickup_city,
        pickup_state: row.pickup_state,
        pickup_pincode: row.pickup_pincode,
        pickup_location: row.pickup_location,
        package_weight_kg: Number(row.package_weight_kg || 0),
        package_length_cm: Number(row.package_length_cm || 0),
        package_breadth_cm: Number(row.package_breadth_cm || 0),
        package_height_cm: Number(row.package_height_cm || 0),
        courier_name: row.courier_name,
        shipping_amount: Number(row.shipping_amount || 0),
        shiprocket_order_id: row.shiprocket_order_id,
        shiprocket_shipment_id: row.shiprocket_shipment_id,
        awb_code: row.awb_code,
        shipment_status: row.shipment_status,
        shipment_note: row.shipment_note,
        items: Array.isArray(row.items) ? row.items : [],
      })),
    };

    const displayItems = role === 'artist'
      ? safeItems.filter((item) => String(item.artist_id || '') === String(artistId || '') || (!item.artist_id && String(item.artist_name || '').trim().toLowerCase() === artistNameForRequest))
      : safeItems;
    return NextResponse.json({ order: safeOrder, items: displayItems, shipments: safeOrder.shipments, role });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load this order document.' }, { status: 401 });
  }
}
