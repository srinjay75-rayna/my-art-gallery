import nodemailer from 'nodemailer';

const DEADLINE_HOURS = 72;
const safe = (value) => String(value ?? '').trim();
const formatIndiaDateTime = (value) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short', hour12: true,
}).format(new Date(value));

function partnerItems(order) {
  return (Array.isArray(order?.items) ? order.items : []).filter((item) => item?.packing_mode === 'partner');
}

function dimensionsFor(item) {
  const l = Number(item.length_cm) || 0;
  const b = Number(item.breadth_cm) || 0;
  const d = Number(item.height_cm) || 0;
  return `${l} × ${b} × ${d} cm`;
}

function formatFor(item) {
  const base = safe(item.delivery_format) || 'Stretched Canvas (Gallery-Wrapped, Unframed)';
  if (base === 'Other (Specify exact format)') return safe(item.delivery_format_other) || 'Other format (details not supplied)';
  return base;
}

function pickupDetails(item) {
  const snapshot = item.pickup_snapshot || {};
  const address = [snapshot.pickup_address, snapshot.pickup_landmark, snapshot.pickup_locality, snapshot.pickup_city, snapshot.pickup_state].map(safe).filter(Boolean).join(', ');
  return {
    seller: safe(snapshot.pickup_contact_name || snapshot.artist_name || item.artist_name || 'Artiste Artist'),
    address: address || 'Pickup address not supplied',
    phone: safe(snapshot.pickup_phone) || 'Not supplied',
    pincode: safe(snapshot.pickup_pincode),
  };
}

export function buildPackerDispatchSummary(order) {
  const items = partnerItems(order);
  if (!items.length) return null;
  const confirmedAt = new Date(order.paid_at || order.created_at || Date.now());
  const deadline = new Date(confirmedAt.getTime() + DEADLINE_HOURS * 60 * 60 * 1000);
  const lines = [
    `Order ID: ${safe(order.merchant_order_ref || order.id)}`,
    ...items.flatMap((item, index) => {
      const pickup = pickupDetails(item);
      return [
        `Artwork ${index + 1}: ${safe(item.title) || 'Artwork'}`,
        `Dimensions (L × B × D): ${dimensionsFor(item)}`,
        `Presentation & delivery format: ${formatFor(item)}`,
        `Seller: ${pickup.seller}`,
        `Full studio pickup address: ${pickup.address}`,
        `Seller phone: ${pickup.phone}`,
        `Seller 6-digit PIN code: ${pickup.pincode || 'Not supplied'}`,
      ];
    }),
    `Packing completion deadline: ${formatIndiaDateTime(deadline)} IST (within 72 hours of order confirmation)`,
  ];
  return { message: lines.join('\n'), deadline: deadline.toISOString(), items };
}

function makeTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP is not configured for packer dispatch email.');
  return nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, tls: { minVersion: 'TLSv1.2' }, auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
}

async function ensureDispatchRow(supabase, order, summary) {
  const { error } = await supabase.from('packer_dispatches').upsert({
    order_id: order.id,
    order_ref: safe(order.merchant_order_ref || order.id),
    dispatch_summary: summary.message,
    packing_deadline_at: summary.deadline,
  }, { onConflict: 'order_id', ignoreDuplicates: true });
  if (error) throw error;
}

async function claimChannel(supabase, orderId, field) {
  const sentField = field === 'email' ? 'email_sent_at' : 'whatsapp_sent_at';
  const { data, error } = await supabase.from('packer_dispatches')
    .update({ [`${field}_status`]: 'sending', last_error: null })
    .eq('order_id', orderId)
    .in(`${field}_status`, ['pending', 'failed', 'not_configured'])
    .select(`id,${field}_status,${sentField}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sendEmail(supabase, order, summary) {
  const recipient = safe(process.env.PACKER_EMAIL);
  if (!recipient) {
    await supabase.from('packer_dispatches').update({ email_status: 'not_configured' }).eq('order_id', order.id);
    return { sent: false, reason: 'PACKER_EMAIL is not configured.' };
  }
  const claim = await claimChannel(supabase, order.id, 'email');
  if (!claim) return { sent: false, reason: 'Email dispatch already sent or currently processing.' };
  try {
    const transport = makeTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || `Artiste <${process.env.SMTP_USER}>`,
      to: recipient,
      subject: `Artiste packing pickup · ${safe(order.merchant_order_ref || order.id)}`,
      text: summary.message,
    });
    await supabase.from('packer_dispatches').update({ email_status: 'sent', email_sent_at: new Date().toISOString(), last_error: null }).eq('order_id', order.id);
    return { sent: true };
  } catch (error) {
    await supabase.from('packer_dispatches').update({ email_status: 'failed', last_error: `Email: ${error.message}`.slice(0, 1800) }).eq('order_id', order.id);
    return { sent: false, reason: error.message };
  }
}

export async function sendPartnerWhatsAppDispatch(supabase, order) {
  const summary = buildPackerDispatchSummary(order);
  if (!summary) return { sent: false, message: 'This order does not contain Ganesh partner packing.' };
  await ensureDispatchRow(supabase, order, summary);
  const { data: priorDispatch, error: priorError } = await supabase.from('packer_dispatches')
    .select('whatsapp_status,whatsapp_sent_at')
    .eq('order_id', order.id)
    .maybeSingle();
  if (priorError) throw priorError;
  if (priorDispatch?.whatsapp_status === 'sent' || priorDispatch?.whatsapp_sent_at) {
    return { sent: false, alreadySent: true, message: 'The WhatsApp packing dispatch has already been sent for this order.' };
  }
  const to = safe(process.env.PACKER_WHATSAPP);
  const apiUrl = safe(process.env.WHATSAPP_API_URL);
  const token = safe(process.env.WHATSAPP_API_TOKEN);
  if (!to || !apiUrl || !token) {
    await supabase.from('packer_dispatches').update({ whatsapp_status: 'not_configured' }).eq('order_id', order.id);
    return { sent: false, message: 'WhatsApp dispatch is not configured on the server.' };
  }
  const claim = await claimChannel(supabase, order.id, 'whatsapp');
  if (!claim) return { sent: false, message: 'WhatsApp dispatch has already been sent or is currently processing.' };
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, message: summary.message }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `WhatsApp provider returned HTTP ${response.status}.`);
    await supabase.from('packer_dispatches').update({ whatsapp_status: 'sent', whatsapp_sent_at: new Date().toISOString(), last_error: null }).eq('order_id', order.id);
    return { sent: true, message: 'Ganesh Packers and Movers dispatch was sent on WhatsApp.' };
  } catch (error) {
    await supabase.from('packer_dispatches').update({ whatsapp_status: 'failed', last_error: `WhatsApp: ${error.message}`.slice(0, 1800) }).eq('order_id', order.id);
    return { sent: false, message: error.message || 'WhatsApp dispatch failed.' };
  }
}

export async function sendPartnerPackingNotifications(supabase, order) {
  const summary = buildPackerDispatchSummary(order);
  if (!summary) return { partnerPacking: false };
  try {
    await ensureDispatchRow(supabase, order, summary);
    const emailResult = await sendEmail(supabase, order, summary);
    const whatsappResult = await sendPartnerWhatsAppDispatch(supabase, order);
    return { partnerPacking: true, email: emailResult, whatsapp: whatsappResult };
  } catch (error) {
    console.error('Ganesh Packers and Movers dispatch record failed:', error?.message || error);
    return { partnerPacking: true, error: error.message };
  }
}
