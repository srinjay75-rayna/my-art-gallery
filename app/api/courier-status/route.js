import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function secureMatch(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  const configuredSecret = process.env.SHIPROCKET_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: 'Shiprocket webhook secret is not configured.' }, { status: 503 });
  }

  const suppliedSecret = request.headers.get('x-api-key') || request.headers.get('x-artiste-webhook-secret') || request.headers.get('x-webhook-secret') || '';
  if (!secureMatch(suppliedSecret, configuredSecret)) {
    return NextResponse.json({ error: 'Webhook authentication failed.' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const tracking = payload?.tracking_data || payload?.tracking || {};
    const shipment = payload?.shipment || payload?.data?.shipment || {};
    const data = payload?.data || {};
    const status = firstString(
      payload?.current_status, payload?.shipment_status, payload?.status,
      payload?.awb_status, tracking?.shipment_status, tracking?.current_status,
      shipment?.status, data?.shipment_status, data?.current_status
    ).toLowerCase();
    if (!/\bdelivered\b/i.test(status)) {
      return NextResponse.json({ ok: true, ignored: true, status: status || 'unknown' });
    }

    const awb = firstString(
      payload?.awb, payload?.awb_code, payload?.awb_number,
      tracking?.awb_code, tracking?.awb, shipment?.awb_code,
      shipment?.awb, data?.awb_code, data?.awb
    ).replace(/[^a-zA-Z0-9_-]/g, '');
    const shipmentId = firstString(
      payload?.shipment_id, tracking?.shipment_id, shipment?.id,
      shipment?.shipment_id, data?.shipment_id
    ).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!awb && !shipmentId) {
      return NextResponse.json({ error: 'Delivered event did not include an AWB or shipment ID.' }, { status: 400 });
    }

    const supabase = requireServiceRole();
    let shipmentQuery = supabase.from('order_shipments').select('id,awb_code,shiprocket_shipment_id,delivered_at');
    if (awb) shipmentQuery = shipmentQuery.eq('awb_code', awb);
    else shipmentQuery = shipmentQuery.eq('shiprocket_shipment_id', shipmentId);
    let { data: matched, error: matchError } = await shipmentQuery.maybeSingle();
    if (matchError) throw matchError;
    if (!matched && awb && shipmentId) {
      const fallback = await supabase.from('order_shipments').select('id,awb_code,shiprocket_shipment_id,delivered_at').eq('shiprocket_shipment_id', shipmentId).maybeSingle();
      if (fallback.error) throw fallback.error;
      matched = fallback.data;
    }
    if (!matched) return NextResponse.json({ error: 'No Artiste shipment matches this courier event.' }, { status: 404 });

    const lastScan = Array.isArray(tracking?.scans) ? tracking.scans.find((scan) => /\bdelivered\b/i.test(String(scan?.status || scan?.activity || ''))) : null;
    const deliveredValue = firstString(payload?.delivered_at, payload?.delivered_date, payload?.current_timestamp, payload?.current_status_date, tracking?.delivered_at, tracking?.current_timestamp, tracking?.current_status_date, shipment?.delivered_at, lastScan?.date, lastScan?.timestamp);
    const deliveredAt = deliveredValue && !Number.isNaN(Date.parse(deliveredValue)) ? new Date(deliveredValue).toISOString() : new Date().toISOString();
    const { data: result, error: rpcError } = await supabase.rpc('artiste_mark_shipment_delivered', {
      p_shipment_id: matched.id,
      p_delivered_at: deliveredAt,
    });
    if (rpcError) throw rpcError;
    if (result !== true) return NextResponse.json({ error: 'The shipment could not be marked as delivered.' }, { status: 409 });
    return NextResponse.json({ ok: true, shipment_id: matched.id, delivered_at: deliveredAt, payout_available_at: new Date(new Date(deliveredAt).getTime() + 48 * 60 * 60 * 1000).toISOString() });
  } catch (error) {
    console.error('Shiprocket Delivered webhook failed:', error?.message || error);
    return NextResponse.json({ error: error.message || 'Could not process courier delivery event.' }, { status: 500 });
  }
}
