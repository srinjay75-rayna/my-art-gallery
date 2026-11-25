import crypto from 'node:crypto';

let cachedToken = null;
let tokenExpiresAt = 0;
const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

async function getShiprocketToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return cachedToken;
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error('Shiprocket credentials are missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.');
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.message || 'Shiprocket authentication failed. Check the API user credentials.');
  cachedToken = data.token;
  // Shiprocket tokens are normally valid for ten days. Refresh conservatively.
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

export async function shiprocketRequest(path, options = {}) {
  const token = await getShiprocketToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
    signal: options.signal || AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.message || data.error || data.errors || `Shiprocket returned HTTP ${response.status}.`;
    throw new Error(typeof details === 'string' ? details : JSON.stringify(details));
  }
  return data;
}

export function aggregatePackage(paintings) {
  if (!Array.isArray(paintings) || !paintings.length) throw new Error('Add at least one available artwork to your cart.');
  const weight = paintings.reduce((sum, item) => { const raw = item.weight_kg; const parsed = raw === null || raw === undefined || raw === '' ? NaN : Number(raw); return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0.5); }, 0);
  const dimensions = ['length_cm', 'breadth_cm', 'height_cm'];
  // Combined parcels use summed packed weight and the largest dimension on each axis.
  const box = Object.fromEntries(dimensions.map((key) => [key, Math.max(...paintings.map((item) => Number(item[key] || 0)))]));
  const declaredValue = paintings.reduce((sum, item) => sum + Number(item.price || 0), 0);
  for (const [key, value] of Object.entries({ weight, declaredValue, ...box })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`A valid ${key.replaceAll('_', ' ')} is missing from one of the artworks.`);
  }
  return { weight: Number(weight.toFixed(3)), ...box, declaredValue: Number(declaredValue.toFixed(2)) };
}

function originForPainting(painting) {
  const fallbackPin = String(process.env.PICKUP_PINCODE || '');
  const fallbackLocation = String(process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary');
  const pickupPincode = String(painting.pickup_pincode || painting.origin_pincode || fallbackPin);
  const pickupLocation = String(painting.pickup_location || painting.origin_location || fallbackLocation);
  if (!/^\d{6}$/.test(pickupPincode)) throw new Error(`A valid 6-digit Artist pickup PIN code is missing for “${painting.title || 'an artwork'}”.`);
  if (!pickupLocation || pickupLocation.length > 100) throw new Error(`A valid Shiprocket pickup-location name is missing for “${painting.title || 'an artwork'}”.`);
  return { pickupPincode, pickupLocation, pickupCity: String(painting.pickup_city || painting.city || process.env.PICKUP_CITY || ''), pickupState: String(painting.pickup_state || painting.state || process.env.PICKUP_STATE || '') };
}

export function groupPaintingsByPickup(paintings) {
  if (!Array.isArray(paintings) || !paintings.length) throw new Error('No artworks were selected.');
  const groups = new Map();
  for (const painting of paintings) {
    const origin = originForPainting(painting);
    const artistKey = String(painting.artist_id || 'artiste-owner');
    const groupKey = crypto.createHash('sha256').update(`${artistKey}|${origin.pickupPincode}|${origin.pickupLocation}`).digest('hex').slice(0, 24);
    if (!groups.has(groupKey)) groups.set(groupKey, { groupKey, artist_id: painting.artist_id || null, artist_name: painting.artist_name || 'Artiste Studio', ...origin, items: [] });
    groups.get(groupKey).items.push(painting);
  }
  return [...groups.values()].map((group, index) => ({ ...group, groupIndex: index + 1, package: aggregatePackage(group.items) }));
}

async function getRatesForGroup(group, deliveryPincode) {
  const params = new URLSearchParams({
    pickup_postcode: group.pickupPincode,
    delivery_postcode: String(deliveryPincode),
    weight: String(group.package.weight),
    cod: '0',
    length: String(group.package.length_cm),
    breadth: String(group.package.breadth_cm),
    height: String(group.package.height_cm),
    declared_value: String(group.package.declaredValue),
  });
  const result = await shiprocketRequest(`/courier/serviceability/?${params.toString()}`, { method: 'GET' });
  const companies = result?.data?.available_courier_companies || result?.available_courier_companies || [];
  return companies.map((courier) => ({
    courier_company_id: Number(courier.courier_company_id),
    courier_name: String(courier.courier_name || courier.name || 'Courier'),
    rate: Math.round(Number(courier.rate)),
    etd: String(courier.etd || courier.estimated_delivery_days || ''),
  })).filter((courier) => Number.isInteger(courier.courier_company_id) && courier.courier_company_id > 0 && Number.isFinite(courier.rate) && courier.rate >= 0);
}

function normaliseLocation(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function getFallbackShippingZone(group, deliveryPincode, deliveryAddress = {}) {
  const pickupPin = String(group.pickupPincode || '');
  const dropPin = String(deliveryPincode || '');
  const sameFirstThreeDigits = pickupPin.slice(0, 3) === dropPin.slice(0, 3);
  const pickupState = normaliseLocation(group.pickupState);
  const deliveryState = normaliseLocation(deliveryAddress.state);
  const pickupCity = normaliseLocation(group.pickupCity);
  const deliveryCity = normaliseLocation(deliveryAddress.city);

  if (sameFirstThreeDigits || (pickupCity && deliveryCity && pickupCity === deliveryCity && pickupState && pickupState === deliveryState)) {
    return { zone: 'intracity', courier_company_id: -103, courier_name: 'Artiste Low-Cost Courier — Intracity', rate: 45, etd: 'Local delivery coordination' };
  }
  if (pickupState && deliveryState && pickupState === deliveryState) {
    return { zone: 'intrastate', courier_company_id: -104, courier_name: 'Artiste Low-Cost Surface — Intrastate', rate: 70, etd: 'Same-state delivery coordination' };
  }
  return { zone: 'interstate', courier_company_id: -105, courier_name: 'Artiste Low-Cost Surface — Interstate', rate: 110, etd: 'Interstate delivery coordination' };
}

/** Fetch raw Shiprocket Serviceability rates, with low-cost zone fallback rates if unavailable. */
export async function getCourierRatesByPickup(paintings, deliveryPincode, deliveryAddress = {}) {
  if (!/^\d{6}$/.test(String(deliveryPincode || ''))) throw new Error('Enter a valid 6-digit delivery PIN code.');
  const groups = groupPaintingsByPickup(paintings);
  return Promise.all(groups.map(async (group) => {
    let couriers = [];
    let shiprocketUnavailable = false;
    try {
      couriers = await getRatesForGroup(group, deliveryPincode);
      shiprocketUnavailable = couriers.length === 0;
    } catch (error) {
      shiprocketUnavailable = true;
      console.warn(`Shiprocket quote unavailable for ${group.artist_name}; using zone fallback:`, error.message);
    }

    if (shiprocketUnavailable) {
      couriers = [{
        ...getFallbackShippingZone(group, deliveryPincode, deliveryAddress),
        delivery_mode: 'artiste_fallback',
        description: 'Low-cost fallback quote; delivery is coordinated by Artiste and the Artist.',
      }];
    } else {
      couriers = couriers.map((courier) => ({ ...courier, delivery_mode: 'shiprocket' }));
    }

    couriers.sort((a, b) => a.rate - b.rate || a.courier_name.localeCompare(b.courier_name));
    return { groupKey: group.groupKey, artistName: group.artist_name, itemCount: group.items.length, package: group.package, shippingZone: couriers[0]?.zone || 'shiprocket', couriers };
  }));
}

export function getShiprocketPickupDate(notBeforeAt) {
  const threshold = new Date(notBeforeAt || Date.now());
  if (!Number.isFinite(threshold.getTime())) throw new Error('The packing deadline timestamp is invalid.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(threshold);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const next = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export async function requestShiprocketPickup(shipmentId, notBeforeAt, scheduledDate = null) {
  if (!shipmentId) throw new Error('Shiprocket shipment ID is required before pickup can be scheduled.');
  const pickupDate = scheduledDate || getShiprocketPickupDate(notBeforeAt);
  await shiprocketRequest('/courier/generate/pickup', {
    method: 'POST',
    body: JSON.stringify({ shipment_id: Number(shipmentId), pickup_date: [pickupDate] }),
  });
  return { pickupScheduledDate: pickupDate, pickupRequestedAt: new Date().toISOString() };
}

export async function createShiprocketShipment(order, shipmentGroup) {
  const items = Array.isArray(shipmentGroup.items) && shipmentGroup.items.length ? shipmentGroup.items : [];
  const packageData = aggregatePackage(items);
  const [firstName, ...rest] = String(order.customer_name || order.buyer_name || '').trim().split(/\s+/);
  const orderDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const fullAddress = [order.shipping_address || order.buyer_address, order.locality, order.landmark].filter(Boolean).join(', ');
  const shiprocketRef = String(shipmentGroup.shiprocket_reference || `${order.merchant_order_ref}-${String(shipmentGroup.group_index || 1).padStart(2, '0')}`).slice(0, 50);
  const payload = {
    order_id: shiprocketRef,
    order_date: orderDate,
    pickup_location: shipmentGroup.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
    billing_customer_name: firstName || 'Artiste',
    billing_last_name: rest.join(' ') || 'Customer',
    billing_address: fullAddress,
    billing_city: order.city || order.buyer_city,
    billing_pincode: Number(order.pincode || order.buyer_pincode),
    billing_state: order.state || order.buyer_state,
    billing_country: 'India',
    billing_email: order.customer_email || order.buyer_email,
    billing_phone: String(order.customer_phone || order.buyer_phone || '').replace(/\D/g, '').slice(-10),
    shipping_is_billing: true,
    order_items: items.map((item, index) => ({ name: String(`${item.title || `Artwork ${index + 1}`} — ${item.delivery_format === 'Other (Specify exact format)' ? (item.delivery_format_other || 'Other format') : (item.delivery_format || 'Stretched Canvas (Gallery-Wrapped, Unframed)')}`).slice(0, 200), sku: `ART-${String(item.id || index).slice(0, 30)}`, units: 1, selling_price: Number(item.price || 0), discount: 0, tax: 0 })),
    payment_method: 'Prepaid',
    shipping_charges: Number(shipmentGroup.shipping_amount || 0),
    sub_total: packageData.declaredValue,
    length: packageData.length_cm,
    breadth: packageData.breadth_cm,
    height: packageData.height_cm,
    weight: packageData.weight,
  };
  const created = await shiprocketRequest('/orders/create/adhoc', { method: 'POST', body: JSON.stringify(payload) });
  const shiprocketOrderId = created.order_id || created.data?.order_id || null;
  const shipmentId = created.shipment_id || created.data?.shipment_id || null;
  let awbCode = null;
  let awbMessage = '';
  if (shipmentId && shipmentGroup.courier_id) {
    try {
      const assigned = await shiprocketRequest('/courier/assign/awb', { method: 'POST', body: JSON.stringify({ shipment_id: shipmentId, courier_id: Number(shipmentGroup.courier_id) }) });
      awbCode = assigned.response?.data?.awb_code || assigned.awb_code || assigned.data?.awb_code || null;
    } catch (error) {
      awbMessage = `Shiprocket order created, but AWB assignment needs attention: ${error.message}`;
    }
  }
  let pickupMessage = '';
  let pickupScheduledDate = null;
  let pickupRequestedAt = null;
  const notBeforeAt = shipmentGroup.pickup_not_before_at || (order.paid_at ? new Date(new Date(order.paid_at).getTime() + 72 * 60 * 60 * 1000).toISOString() : null);
  if (shipmentId && awbCode && notBeforeAt) {
    try {
      const pickup = await requestShiprocketPickup(shipmentId, notBeforeAt, shipmentGroup.pickup_scheduled_date || null);
      pickupScheduledDate = pickup.pickupScheduledDate;
      pickupRequestedAt = pickup.pickupRequestedAt;
    } catch (error) {
      pickupMessage = `AWB is assigned, but Shiprocket pickup scheduling needs attention: ${error.message}`;
    }
  } else if (shipmentId && !awbCode) {
    pickupMessage = 'Pickup will be requested after Shiprocket returns an AWB; the 72-hour packing window is recorded.';
  }
  return { shiprocketOrderId, shipmentId, awbCode, awbMessage, pickupMessage, pickupScheduledDate, pickupRequestedAt, pickupNotBeforeAt: notBeforeAt };
}
