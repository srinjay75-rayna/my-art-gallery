let cachedToken = null;
let tokenExpiresAt = 0;
const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

async function getShiprocketToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return cachedToken;
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error('Shiprocket credentials are missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.');
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.message || 'Shiprocket authentication failed. Check your API user credentials.');
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

export async function shiprocketRequest(path, options = {}) {
  const token = await getShiprocketToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.message || data.error || data.errors || `Shiprocket returned HTTP ${response.status}.`;
    throw new Error(typeof details === 'string' ? details : JSON.stringify(details));
  }
  return data;
}

export function aggregatePackage(paintings) {
  if (!Array.isArray(paintings) || !paintings.length) throw new Error('Add at least one available painting to your cart.');
  const weight = paintings.reduce((sum, item) => sum + Number(item.weight_kg || 0), 0);
  const dimensions = ['length_cm', 'breadth_cm', 'height_cm'];
  const box = Object.fromEntries(dimensions.map((key) => [key, Math.max(...paintings.map((item) => Number(item[key] || 0)))]));
  const declaredValue = paintings.reduce((sum, item) => sum + Number(item.price || 0), 0);
  for (const [key, value] of Object.entries({ weight, declaredValue, ...box })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`A valid ${key.replaceAll('_', ' ')} is missing from one of the paintings.`);
  }
  return { weight, ...box, declaredValue };
}

export async function getCourierRates({ paintings, painting, deliveryPincode }) {
  const packageData = aggregatePackage(paintings || [painting]);
  const pickupPincode = String(process.env.PICKUP_PINCODE || '');
  if (!/^\d{6}$/.test(pickupPincode)) throw new Error('Set a valid 6-digit PICKUP_PINCODE in the server environment.');
  if (!/^\d{6}$/.test(String(deliveryPincode || ''))) throw new Error('Enter a valid 6-digit delivery PIN code.');
  const params = new URLSearchParams({
    pickup_postcode: pickupPincode, delivery_postcode: String(deliveryPincode),
    weight: String(packageData.weight), cod: '0', length: String(packageData.length_cm),
    breadth: String(packageData.breadth_cm), height: String(packageData.height_cm),
    declared_value: String(packageData.declaredValue),
  });
  const result = await shiprocketRequest(`/courier/serviceability/?${params.toString()}`, { method: 'GET' });
  const companies = result?.data?.available_courier_companies || result?.available_courier_companies || [];
  return companies.map((courier) => ({
    courier_company_id: Number(courier.courier_company_id),
    courier_name: String(courier.courier_name || courier.name || 'Courier'),
    rate: Number(courier.rate ?? courier.freight_charge ?? courier.rto_charges ?? 0),
    etd: String(courier.etd || courier.estimated_delivery_days || ''),
  })).filter((courier) => Number.isFinite(courier.courier_company_id) && courier.courier_company_id > 0 && Number.isFinite(courier.rate) && courier.rate >= 0);
}

export async function createShiprocketShipment(order) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{
    id: order.painting_id, title: order.painting_title, price: order.artwork_price,
    weight_kg: order.weight_kg, length_cm: order.length_cm, breadth_cm: order.breadth_cm, height_cm: order.height_cm,
  }];
  const totalWeight = items.reduce((sum, item) => sum + Number(item.weight_kg || 0), 0);
  const packageDims = {
    length_cm: Math.max(...items.map((item) => Number(item.length_cm || 0))),
    breadth_cm: Math.max(...items.map((item) => Number(item.breadth_cm || 0))),
    height_cm: Math.max(...items.map((item) => Number(item.height_cm || 0))),
  };
  const [firstName, ...rest] = String(order.buyer_name || '').trim().split(/\s+/);
  const orderDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payload = {
    order_id: String(order.merchant_order_ref || `ART${Date.now()}`).slice(0, 20), order_date: orderDate,
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
    billing_customer_name: firstName || 'Artiste', billing_last_name: rest.join(' ') || 'Customer',
    billing_address: order.buyer_address, billing_city: order.buyer_city, billing_pincode: Number(order.buyer_pincode),
    billing_state: order.buyer_state, billing_country: 'India', billing_email: order.buyer_email, billing_phone: order.buyer_phone,
    shipping_is_billing: true,
    order_items: items.map((item, index) => ({
      name: String(item.title || `Artwork ${index + 1}`).slice(0, 200), sku: `ART-${String(item.id || index).slice(0, 30)}`,
      units: 1, selling_price: Number(item.price || 0), discount: 0, tax: 0,
    })),
    payment_method: 'Prepaid', shipping_charges: Number(order.shipping_price),
    sub_total: Number(order.artwork_price), length: packageDims.length_cm,
    breadth: packageDims.breadth_cm, height: packageDims.height_cm, weight: totalWeight,
  };
  const created = await shiprocketRequest('/orders/create/adhoc', { method: 'POST', body: JSON.stringify(payload) });
  const shiprocketOrderId = created.order_id || created.data?.order_id || null;
  const shipmentId = created.shipment_id || created.data?.shipment_id || null;
  let awbCode = null;
  let awbMessage = '';
  if (shipmentId && order.courier_id) {
    try {
      const assigned = await shiprocketRequest('/courier/assign/awb', {
        method: 'POST', body: JSON.stringify({ shipment_id: shipmentId, courier_id: Number(order.courier_id) }),
      });
      awbCode = assigned.response?.data?.awb_code || assigned.awb_code || assigned.data?.awb_code || null;
    } catch (error) { awbMessage = `Order created, but AWB assignment needs attention: ${error.message}`; }
  }
  return { shiprocketOrderId, shipmentId, awbCode, awbMessage, raw: created };
}
