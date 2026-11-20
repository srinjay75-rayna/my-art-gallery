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
  // Shiprocket tokens are documented as valid for 10 days; refresh a little early.
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

export async function shiprocketRequest(path, options = {}) {
  const token = await getShiprocketToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.message || data.error || data.errors || `Shiprocket returned HTTP ${response.status}.`;
    throw new Error(typeof details === 'string' ? details : JSON.stringify(details));
  }
  return data;
}

export async function getCourierRates({ painting, deliveryPincode }) {
  const pickupPincode = String(process.env.PICKUP_PINCODE || '');
  if (!/^\d{6}$/.test(pickupPincode)) throw new Error('Set a valid 6-digit PICKUP_PINCODE in the server environment.');
  if (!/^\d{6}$/.test(String(deliveryPincode || ''))) throw new Error('Enter a valid 6-digit delivery PIN code.');

  const params = new URLSearchParams({
    pickup_postcode: pickupPincode,
    delivery_postcode: String(deliveryPincode),
    weight: String(Number(painting.weight_kg)),
    cod: '0',
    length: String(Number(painting.length_cm)),
    breadth: String(Number(painting.breadth_cm)),
    height: String(Number(painting.height_cm)),
    declared_value: String(Number(painting.price)),
  });
  const result = await shiprocketRequest(`/courier/serviceability/?${params.toString()}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  const companies = result?.data?.available_courier_companies || result?.available_courier_companies || [];
  return companies.map((courier) => ({
    courier_company_id: Number(courier.courier_company_id),
    courier_name: String(courier.courier_name || courier.name || 'Courier'),
    rate: Number(courier.rate ?? courier.freight_charge ?? courier.rto_charges ?? 0),
    etd: String(courier.etd || courier.estimated_delivery_days || ''),
  })).filter((courier) => Number.isFinite(courier.courier_company_id) && courier.courier_company_id > 0 && Number.isFinite(courier.rate) && courier.rate >= 0);
}

export async function createShiprocketShipment(order, painting) {
  const nameParts = String(order.buyer_name || '').trim().split(/\s+/);
  const firstName = nameParts.shift() || 'Art';
  const lastName = nameParts.join(' ') || 'Buyer';
  const orderDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const externalOrderId = String(order.merchant_order_ref || `RG${Date.now()}`).slice(0, 20);
  const payload = {
    order_id: externalOrderId,
    order_date: orderDate,
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: order.buyer_address,
    billing_city: order.buyer_city,
    billing_pincode: Number(order.buyer_pincode),
    billing_state: order.buyer_state,
    billing_country: 'India',
    billing_email: order.buyer_email,
    billing_phone: order.buyer_phone,
    shipping_is_billing: true,
    order_items: [{
      name: painting.title,
      sku: `ART-${String(painting.id).slice(0, 30)}`,
      units: 1,
      selling_price: Number(painting.price),
      discount: 0,
      tax: 0,
    }],
    payment_method: 'Prepaid',
    shipping_charges: Number(order.shipping_price),
    sub_total: Number(painting.price),
    length: Number(painting.length_cm),
    breadth: Number(painting.breadth_cm),
    height: Number(painting.height_cm),
    weight: Number(painting.weight_kg),
  };

  const created = await shiprocketRequest('/orders/create/adhoc', {
    method: 'POST', body: JSON.stringify(payload),
  });
  const shiprocketOrderId = created.order_id || created.data?.order_id || null;
  const shipmentId = created.shipment_id || created.data?.shipment_id || null;
  let awbCode = null;
  let awbMessage = '';

  // AWB assignment is attempted after the Shiprocket order is successfully created.
  // Some courier/order combinations may need manual action in the Shiprocket panel.
  if (shipmentId && order.courier_id) {
    try {
      const assigned = await shiprocketRequest('/courier/assign/awb', {
        method: 'POST', body: JSON.stringify({ shipment_id: shipmentId, courier_id: Number(order.courier_id) }),
      });
      awbCode = assigned.response?.data?.awb_code || assigned.awb_code || assigned.data?.awb_code || null;
    } catch (error) {
      awbMessage = `Order created, but AWB assignment needs attention: ${error.message}`;
    }
  }

  return { shiprocketOrderId, shipmentId, awbCode, awbMessage, raw: created };
}
