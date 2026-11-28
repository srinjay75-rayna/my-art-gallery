import nodemailer from 'nodemailer';

const clean = (value) => String(value ?? '').trim();
const safeMoney = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function smtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP is not configured for Print Lab fulfilment email.');
  }
  return nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass }, tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
}

function buildPayload(order, item) {
  return {
    order_id: order.id,
    order_reference: order.merchant_order_ref || order.id,
    order_item_id: item.id,
    photograph_title: item.title || 'Fine-Art Photograph',
    high_resolution_image_url: item.high_res_image_url || item.image_url || '',
    grade: Number(item.edition_grade || 1),
    grade_name: item.edition_grade_name || '',
    size: item.edition_size || item.dimensions || '',
    edition_number: Number(item.edition_number || 0),
    edition_total: Number(item.edition_total || item.edition_limit || 0),
    coa_serial: item.coa_serial || item.certificate_id || '',
    substrate: item.substrate_specs || '',
    framing: item.framing_specs || '',
    package_dimensions_cm: { length: Number(item.length_cm || 0), breadth: Number(item.breadth_cm || 0), height: Number(item.height_cm || 0), weight_kg: Number(item.weight_kg || 0) },
    artist_name: item.artist_name || '',
    artist_id: item.artist_id || null,
    photographer_fee: Number(item.photography_artist_fee ?? item.artist_payout ?? 0),
    print_lab_cost: Number(item.photography_lab_cost || 0),
    collector: {
      name: order.customer_name || order.buyer_name || '',
      email: order.customer_email || order.buyer_email || '',
      phone: order.customer_phone || order.buyer_phone || '',
      address: order.shipping_address || order.buyer_address || '',
      landmark: order.landmark || '',
      locality: order.locality || '',
      city: order.city || '',
      state: order.state || '',
      pincode: order.pincode || order.buyer_pincode || '',
    },
    pickup: {
      pincode: process.env.PRINT_LAB_PICKUP_PIN || '',
      location: process.env.PRINT_LAB_PICKUP_LOCATION || 'Primary',
      address: process.env.PRINT_LAB_PICKUP_ADDRESS || '',
      contact_name: process.env.PRINT_LAB_PICKUP_CONTACT || 'Artiste Print Lab',
      phone: process.env.PRINT_LAB_PICKUP_PHONE || '',
      landmark: process.env.PRINT_LAB_PICKUP_LANDMARK || '',
      locality: process.env.PRINT_LAB_PICKUP_LOCALITY || '',
      city: process.env.PRINT_LAB_PICKUP_CITY || '',
      state: process.env.PRINT_LAB_PICKUP_STATE || '',
    },
    shipping_buffer_hours: 72,
    created_at: new Date().toISOString(),
  };
}

async function ensureDispatch(supabase, order, item, payload) {
  const { data, error } = await supabase.from('print_lab_dispatches').upsert({
    order_id: order.id,
    order_item_id: item.id,
    order_ref: clean(order.merchant_order_ref || order.id),
    payload,
  }, { onConflict: 'order_id,order_item_id', ignoreDuplicates: true }).select('*').maybeSingle();
  if (error) throw error;
  if (data) return data;
  const prior = await supabase.from('print_lab_dispatches').select('*').eq('order_id', order.id).eq('order_item_id', item.id).maybeSingle();
  if (prior.error) throw prior.error;
  return prior.data;
}

async function claim(supabase, id, channel) {
  const { data, error } = await supabase.from('print_lab_dispatches')
    .update({ [`${channel}_status`]: 'sending', last_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in(`${channel}_status`, ['pending', 'failed', 'not_configured'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function deliverEmail(supabase, dispatch, payload) {
  const recipient = clean(process.env.PRINT_LAB_EMAIL);
  if (!recipient) {
    await supabase.from('print_lab_dispatches').update({ email_status: 'not_configured' }).eq('id', dispatch.id);
    return;
  }
  if (!(await claim(supabase, dispatch.id, 'email'))) return;
  try {
    const lines = [
      `Artiste Print Lab Production Order`,
      `Order: ${payload.order_reference}`,
      `Photograph: ${payload.photograph_title}`,
      `High-resolution file: ${payload.high_resolution_image_url}`,
      `Grade: ${payload.grade} — ${payload.grade_name}`,
      `Size: ${payload.size}`,
      `Packed parcel size: ${payload.package_dimensions_cm.length} × ${payload.package_dimensions_cm.breadth} × ${payload.package_dimensions_cm.height} cm; ${payload.package_dimensions_cm.weight_kg} kg`,
      `Edition: #${payload.edition_number} of ${payload.edition_total}`,
      `COA / serial: ${payload.coa_serial}`,
      `Substrate: ${payload.substrate}`,
      `Framing: ${payload.framing}`,
      `Photographer payout: ${safeMoney(payload.photographer_fee)}`,
      `Collector: ${payload.collector.name}`,
      `Phone: ${payload.collector.phone}`,
      `Email: ${payload.collector.email}`,
      `Delivery: ${payload.collector.address}, ${payload.collector.landmark}, ${payload.collector.locality}, ${payload.collector.city}, ${payload.collector.state} — ${payload.collector.pincode}`,
      `Print lab pickup PIN: ${payload.pickup.pincode}`,
      `Print lab pickup location: ${payload.pickup.location}`,
      `Print lab pickup address: ${payload.pickup.address}, ${payload.pickup.landmark}, ${payload.pickup.locality}, ${payload.pickup.city}, ${payload.pickup.state} — ${payload.pickup.pincode}`,
      `Print lab pickup contact: ${payload.pickup.contact_name} · ${payload.pickup.phone}`,
      `Shiprocket pickup buffer: minimum 72 hours after payment confirmation.`,
    ];
    const transport = smtpTransport();
    await transport.sendMail({ from: process.env.SMTP_FROM || `Artiste <${process.env.SMTP_USER}>`, to: recipient, subject: `Artiste Print Lab · ${payload.order_reference} · ${payload.photograph_title}`, text: lines.join('\n') });
    await supabase.from('print_lab_dispatches').update({ email_status: 'sent', email_sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', dispatch.id);
  } catch (error) {
    await supabase.from('print_lab_dispatches').update({ email_status: 'failed', last_error: `Email: ${error.message}`.slice(0, 1800), updated_at: new Date().toISOString() }).eq('id', dispatch.id);
    console.error('Print Lab email dispatch failed:', error.message);
  }
}

async function deliverWebhook(supabase, dispatch, payload) {
  const endpoint = clean(process.env.PRINT_LAB_API_URL);
  const key = clean(process.env.PRINT_LAB_API_KEY);
  if (!endpoint || !key) {
    await supabase.from('print_lab_dispatches').update({ webhook_status: 'not_configured' }).eq('id', dispatch.id);
    return;
  }
  if (!(await claim(supabase, dispatch.id, 'webhook'))) return;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Print Lab webhook returned HTTP ${response.status}.`);
    await supabase.from('print_lab_dispatches').update({ webhook_status: 'sent', webhook_sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', dispatch.id);
  } catch (error) {
    await supabase.from('print_lab_dispatches').update({ webhook_status: 'failed', last_error: `Webhook: ${error.message}`.slice(0, 1800), updated_at: new Date().toISOString() }).eq('id', dispatch.id);
    console.error('Print Lab webhook dispatch failed:', error.message);
  }
}

export async function sendPrintLabFulfilment(supabase, order, items) {
  const photographyItems = (Array.isArray(items) ? items : []).filter((item) => item?.print_lab_managed && item?.category === 'Photography');
  for (const item of photographyItems) {
    const payload = buildPayload(order, item);
    try {
      const dispatch = await ensureDispatch(supabase, order, item, payload);
      if (!dispatch) continue;
      await Promise.all([deliverEmail(supabase, dispatch, payload), deliverWebhook(supabase, dispatch, payload)]);
    } catch (error) {
      console.error('Could not prepare Print Lab dispatch:', error.message);
    }
  }
  return { dispatchCount: photographyItems.length };
}
