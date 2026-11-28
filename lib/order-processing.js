import { requireServiceRole } from '@/lib/supabase';
import { createShiprocketShipment, getShiprocketPickupDate, requestShiprocketPickup } from '@/lib/shiprocket';
import { sendPartnerPackingNotifications } from '@/lib/packer-dispatch';
import { postPaidOrderAccounting } from '@/lib/accounting';
import { sendPrintLabFulfilment } from '@/lib/print-lab-dispatch';

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function saveArtistLedger(supabase, order, items) {
  const byArtist = new Map();
  for (const item of items) {
    if (!item.artist_id) continue;
    const row = byArtist.get(item.artist_id) || {
      order_id: order.id,
      order_ref: order.merchant_order_ref,
      artist_id: item.artist_id,
      artist_name: item.artist_name || 'Artiste Artist',
      creator_role: item.creator_role === 'Photographer' ? 'Photographer' : 'Painter',
      commission_rate: Number(item.commission_rate ?? (item.is_founding_artist ? 0.20 : 0.25)),
      gross_amount: 0,
      platform_fee: 0,
      artist_payout: 0,
      payout_status: 'Pending',
    };
    row.creator_role = item.creator_role === 'Photographer' ? 'Photographer' : row.creator_role;
    row.commission_rate = Math.max(Number(row.commission_rate || 0), Number(item.commission_rate ?? (item.is_founding_artist ? 0.20 : 0.25)));
    const artistSaleValue = item.print_lab_managed ? Number(item.photography_artist_fee || item.artist_payout || 0) : Number(item.price || 0);
    row.gross_amount = money(row.gross_amount + artistSaleValue);
    row.platform_fee = money(row.platform_fee + Number(item.platform_fee || 0));
    row.artist_payout = money(row.artist_payout + Number(item.artist_payout || 0));
    byArtist.set(item.artist_id, row);
  }
  if (!byArtist.size) return;
  const { error } = await supabase.from('artist_payouts').upsert([...byArtist.values()], { onConflict: 'order_id,artist_id' });
  if (error) throw new Error(`Paid order saved, but Artist earnings ledger could not be saved: ${error.message}`);
}

async function updateOrderShipmentSummary(supabase, orderId) {
  const { data: rows, error } = await supabase.from('order_shipments')
    .select('shiprocket_order_id,shiprocket_shipment_id,awb_code,shipment_status,shipment_note')
    .eq('order_id', orderId)
    .order('group_index', { ascending: true });
  if (error) throw error;
  const completed = (rows || []).filter((row) => row.shiprocket_order_id || row.shiprocket_shipment_id);
  const localModes = (rows || []).filter((row) => row.shipment_status === 'Local delivery arranged' || row.shipment_status === 'Studio pickup selected');
  const needsAttention = (rows || []).some((row) => row.shipment_status === 'Needs attention');
  const allCreated = rows?.length > 0 && rows.every((row) => row.shiprocket_order_id || row.shiprocket_shipment_id || row.shipment_status === 'Needs attention' || row.shipment_status === 'Local delivery arranged' || row.shipment_status === 'Studio pickup selected');
  const notes = (rows || []).map((row) => row.shipment_note).filter(Boolean);
  const summaryStatus = needsAttention
    ? 'Paid — dispatch needs attention'
    : allCreated && localModes.length === rows.length
      ? 'Local delivery / studio collection selected'
      : allCreated && localModes.length > 0
        ? 'Courier shipments and local arrangements saved'
        : allCreated
          ? 'Shipments created'
          : 'Dispatch processing';
  const { error: updateError } = await supabase.from('orders').update({
    shiprocket_order_id: completed[0]?.shiprocket_order_id ? String(completed[0].shiprocket_order_id) : null,
    shiprocket_shipment_id: completed[0]?.shiprocket_shipment_id ? String(completed[0].shiprocket_shipment_id) : null,
    shiprocket_awb_code: completed[0]?.awb_code || null,
    shipment_status: summaryStatus,
    shipment_note: notes.length ? notes.join(' | ').slice(0, 1800) : null,
  }).eq('id', orderId);
  if (updateError) throw updateError;
  return { shipments: rows || [], allCreated, needsAttention };
}

export async function fulfilPaidOrder(order) {
  const supabase = requireServiceRole();
  const { data: rows, error: rowsError } = await supabase.from('order_shipments').select('*').eq('order_id', order.id).order('group_index', { ascending: true });
  if (rowsError) throw rowsError;
  if (!rows?.length) {
    // Existing v2 orders can still be fulfilled through their legacy single-shipment columns.
    if (order.shiprocket_order_id || order.shiprocket_shipment_id) return { shipmentCreated: true, message: 'Payment received. Shipment is already recorded.' };
    return { shipmentCreated: false, message: 'Payment received. This legacy order has no saved dispatch group; owner review is required.' };
  }

  const notes = [];
  for (const row of rows) {
    if (row.shiprocket_order_id || row.shiprocket_shipment_id) {
      if (row.shiprocket_shipment_id && row.awb_code && !row.pickup_requested_at) {
        try {
          const confirmedAt = new Date(order.paid_at || Date.now());
          const pickupNotBeforeAt = row.pickup_not_before_at || new Date(confirmedAt.getTime() + 72 * 60 * 60 * 1000).toISOString();
          const pickupScheduledDate = row.pickup_scheduled_date || getShiprocketPickupDate(pickupNotBeforeAt);
          const pickup = await requestShiprocketPickup(row.shiprocket_shipment_id, pickupNotBeforeAt, pickupScheduledDate);
          const { error: retrySaveError } = await supabase.from('order_shipments').update({ pickup_not_before_at: pickupNotBeforeAt, pickup_scheduled_date: pickup.pickupScheduledDate, pickup_requested_at: pickup.pickupRequestedAt, shipment_status: 'AWB assigned · pickup scheduled', shipment_note: null }).eq('id', row.id);
          if (retrySaveError) throw retrySaveError;
        } catch (pickupRetryError) {
          const { error: retryNoteError } = await supabase.from('order_shipments').update({ shipment_note: `Shiprocket pickup scheduling retry required: ${pickupRetryError.message}`.slice(0, 1800) }).eq('id', row.id);
          if (retryNoteError) console.error('Could not save pickup retry note:', retryNoteError.message);
          notes.push(`${row.artist_name || 'Artist'} pickup: ${pickupRetryError.message}`);
        }
      }
      continue;
    }
    // Synthetic courier IDs are Artiste's low-cost manual local options. They
    // must not be sent to Shiprocket's AWB API as if they were courier IDs.
    if (Number(row.courier_id) === -101) {
      const { error: localError } = await supabase.from('order_shipments').update({
        shipment_status: 'Local delivery arranged',
        shipment_note: [row.shipment_note, 'Manual local dispatch: the Artist / Artiste will coordinate delivery timing with the Customer.'].filter(Boolean).join(' '),
        shipment_claimed_at: null,
      }).eq('id', row.id);
      if (localError) throw localError;
      continue;
    }
    if (Number(row.courier_id) === -102) {
      const { error: pickupError } = await supabase.from('order_shipments').update({
        shipment_status: 'Studio pickup selected',
        shipment_note: [row.shipment_note, 'Self-collection: the Artist and Customer should coordinate a studio collection time directly.'].filter(Boolean).join(' '),
        shipment_claimed_at: null,
      }).eq('id', row.id);
      if (pickupError) throw pickupError;
      continue;
    }
    if ([-103, -104, -105].includes(Number(row.courier_id))) {
      const zoneLabel = Number(row.courier_id) === -103 ? 'intracity' : Number(row.courier_id) === -104 ? 'intrastate' : 'interstate';
      const { error: fallbackError } = await supabase.from('order_shipments').update({
        shipment_status: 'Local delivery arranged',
        shipment_note: [row.shipment_note, `Artiste low-cost ${zoneLabel} fallback selected; the Artist / Artiste will coordinate insured courier delivery with the Customer.`].filter(Boolean).join(' '),
        shipment_claimed_at: null,
      }).eq('id', row.id);
      if (fallbackError) throw fallbackError;
      continue;
    }
    const { data: claimed, error: claimError } = await supabase.rpc('claim_artiste_order_shipment', { p_shipment_id: row.id });
    if (claimError) throw new Error(`Could not safely claim Shiprocket shipment: ${claimError.message}. Run database/schema.sql.`);
    if (claimed !== true) continue;

    try {
      const confirmedAt = new Date(order.paid_at || Date.now());
      const pickupNotBeforeAt = new Date(confirmedAt.getTime() + 72 * 60 * 60 * 1000).toISOString();
      const pickupScheduledDate = getShiprocketPickupDate(pickupNotBeforeAt);
      const { error: windowError } = await supabase.from('order_shipments').update({
        pickup_not_before_at: pickupNotBeforeAt,
        pickup_scheduled_date: pickupScheduledDate,
      }).eq('id', row.id);
      if (windowError) throw windowError;
      const shipment = await createShiprocketShipment(order, { ...row, pickup_not_before_at: pickupNotBeforeAt, pickup_scheduled_date: pickupScheduledDate });
      const pickupNote = shipment.pickupMessage || (shipment.pickupRequestedAt ? `Shiprocket pickup requested for ${shipment.pickupScheduledDate}; not before ${pickupNotBeforeAt}.` : 'Shiprocket pickup will be requested once the AWB is available.');
      const { error: saveError } = await supabase.from('order_shipments').update({
        shiprocket_order_id: shipment.shiprocketOrderId ? String(shipment.shiprocketOrderId) : null,
        shiprocket_shipment_id: shipment.shipmentId ? String(shipment.shipmentId) : null,
        awb_code: shipment.awbCode,
        pickup_not_before_at: shipment.pickupNotBeforeAt || pickupNotBeforeAt,
        pickup_scheduled_date: shipment.pickupScheduledDate || pickupScheduledDate,
        pickup_requested_at: shipment.pickupRequestedAt,
        shipment_status: shipment.shipmentId ? (shipment.awbCode ? (shipment.pickupRequestedAt ? 'AWB assigned · pickup scheduled' : 'AWB assigned · pickup pending') : 'Shipment created') : 'Needs attention',
        shipment_note: [shipment.awbMessage, shipment.pickupMessage].filter(Boolean).join(' ').slice(0, 1800) || (!shipment.shipmentId ? 'Shiprocket did not return a shipment ID. Owner review required.' : pickupNote),
        shipment_claimed_at: null,
      }).eq('id', row.id);
      if (saveError) throw saveError;
      if (shipment.awbMessage) notes.push(shipment.awbMessage);
      if (shipment.pickupMessage) notes.push(shipment.pickupMessage);
    } catch (error) {
      const { error: resetError } = await supabase.from('order_shipments').update({ shipment_status: 'Needs attention', shipment_note: error.message, shipment_claimed_at: null }).eq('id', row.id);
      if (resetError) console.error('Could not release shipment claim:', resetError.message);
      notes.push(`${row.artist_name || 'Artist'} dispatch: ${error.message}`);
    }
  }

  const summary = await updateOrderShipmentSummary(supabase, order.id);
  return {
    shipmentCreated: summary.shipments.some((row) => row.shiprocket_shipment_id),
    message: notes.length ? `Payment received. Some dispatch steps need attention: ${notes.join(' | ')}` : summary.allCreated ? 'Payment received. Courier, local delivery or studio collection options have been recorded for every Artist pickup location.' : 'Payment received. Dispatch processing is underway.',
  };
}

export async function processCapturedOrder({ order, paymentId }) {
  const supabase = requireServiceRole();
  const confirmedPaidAt = order.paid_at || new Date().toISOString();
  const { data: paymentResult, error: confirmError } = await supabase.rpc('confirm_artiste_payment', { p_order_id: order.id, p_payment_id: paymentId });
  if (confirmError) throw new Error(`Payment confirmation failed: ${confirmError.message}. Run database/schema.sql.`);
  if (paymentResult === 'not_found') throw new Error('Artiste order no longer exists.');
  if (paymentResult === 'payment_mismatch') throw new Error('A different payment has already been recorded for this order.');
  if (paymentResult === 'conflict') {
    return { paid: false, needsManualReview: true, message: 'Payment was captured but one or more artworks were no longer available. Refund review is required; contact Artiste support.' };
  }
  if (!['paid', 'already_paid'].includes(paymentResult)) throw new Error(`Unexpected payment confirmation result: ${paymentResult}`);

  // The atomic database function attaches the edition number and COA serial.
  // Reload its committed order row so downstream accounting, documents and
  // Print Lab dispatch all use the same reserved edition metadata.
  const { data: confirmedOrder, error: confirmedReadError } = await supabase.from('orders').select('*').eq('id', order.id).maybeSingle();
  if (confirmedReadError) throw confirmedReadError;
  if (!confirmedOrder) throw new Error('The confirmed Artiste order could not be reloaded.');
  order = { ...order, ...confirmedOrder };

  const sourceItems = Array.isArray(order.items) && order.items.length ? order.items : [{ id: order.painting_id, title: order.painting_title, price: order.artwork_price }];
  const items = sourceItems.map((item) => {
    const price = money(item.price);
    const role = item.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
    const rate = Number(item.commission_rate ?? (item.is_founding_artist ? 0.20 : 0.25));
    const fee = item.platform_fee == null ? money(price * rate) : money(item.platform_fee);
    return { ...item, creator_role: role, commission_rate: rate, platform_fee: fee, artist_payout: item.artist_payout == null ? money(price - fee) : money(item.artist_payout) };
  });
  const platformFee = money(order.platform_fee ?? items.reduce((sum, item) => sum + item.platform_fee, 0));
  const artistPayout = money(order.artist_payout ?? items.reduce((sum, item) => sum + item.artist_payout, 0));
  const { error: updateError } = await supabase.from('orders').update({
    status: 'Paid',
    payout_status: 'Pending',
    shipment_status: 'Dispatch processing',
    razorpay_payment_id: paymentId,
    paid_at: confirmedPaidAt,
    customer_email: order.customer_email || order.buyer_email,
    customer_name: order.customer_name || order.buyer_name,
    customer_phone: order.customer_phone || order.buyer_phone,
    shipping_address: order.shipping_address || order.buyer_address,
    items,
    platform_fee: platformFee,
    artist_payout: artistPayout,
    shipping_amount: order.shipping_amount ?? order.shipping_price,
    insured_packing_amount: order.insured_packing_amount || 0,
    total_amount: order.total_amount ?? Number(order.amount_paise) / 100,
  }).eq('id', order.id);
  if (updateError) throw updateError;

  await saveArtistLedger(supabase, order, items);
  try {
    await postPaidOrderAccounting(supabase, order, items);
  } catch (accountingError) {
    // Accounting must never interrupt a confirmed Razorpay payment or Shiprocket fulfilment.
    console.error('Automatic sales accounting posting failed; owner reconciliation required:', accountingError?.message || accountingError);
  }
  try {
    await sendPrintLabFulfilment(supabase, { ...order, paid_at: confirmedPaidAt, items }, items);
  } catch (printLabError) {
    // The payment stays confirmed; a missing Print Lab dispatch is an owner-review item.
    console.error('Print Lab dispatch failed; confirmed payment remains intact:', printLabError?.message || printLabError);
  }
  try {
    await sendPartnerPackingNotifications(supabase, { ...order, paid_at: confirmedPaidAt, items });
  } catch (dispatchError) {
    console.error('Partner packer notification failed; confirmed order remains paid:', dispatchError?.message || dispatchError);
  }
  const shipmentResult = await fulfilPaidOrder({ ...order, paid_at: confirmedPaidAt, insured_packing_amount: order.insured_packing_amount || 0, items });
  return { paid: true, ...shipmentResult };
}

export async function loadOrderForPayment(razorpayOrderId) {
  const supabase = requireServiceRole();
  const { data, error } = await supabase.from('orders').select('*').eq('razorpay_order_id', razorpayOrderId).maybeSingle();
  if (error) throw error;
  return data;
}
