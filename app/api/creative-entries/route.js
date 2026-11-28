import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireServiceRole } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';
import { cleanText, enforceRateLimit } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function transport() {
  const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT || 587), user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isInteger(port)) throw new Error('SMTP is not configured for Host notifications.');
  return nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
}
export async function GET(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const status = String(new URL(request.url).searchParams.get('status') || '').trim();
    const supabase = requireServiceRole();
    let query = supabase.from('creative_entries').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ entries: data || [] });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not load creative entries.' }, { status: 500 }); }
}
export async function POST(request) {
  const rate = await enforceRateLimit(request, { scope: 'creative-entry-submit', limit: 5, windowSeconds: 3600 });
  if (!rate.allowed) return NextResponse.json({ error: 'Too many entry submissions. Please try again later.' }, { status: rate.unavailable ? 503 : 429, headers: { 'Retry-After': String(rate.retryAfterSeconds || 3600) } });
  try {
    const body = await request.json();
    const full_name = cleanText(body.full_name, 120), email = cleanText(body.email, 180).toLowerCase();
    const phone = cleanText(body.phone, 30), city = cleanText(body.city, 100);
    const discipline = cleanText(body.discipline, 140), portfolio_url = cleanText(body.portfolio_url, 500);
    const showcase_vision = cleanText(body.showcase_vision, 2500);
    if (full_name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g, '').length < 10 || !city || !discipline || showcase_vision.length < 10) return NextResponse.json({ error: 'Please complete all required details and provide a valid email and phone number.' }, { status: 400 });
    if (portfolio_url && !/^https:\/\//i.test(portfolio_url)) return NextResponse.json({ error: 'Portfolio / social links must begin with https://.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('creative_entries').insert({ full_name, email, phone, city, discipline, portfolio_url, showcase_vision }).select('*').single();
    if (error) throw error;
    let hostNotified = false;
    try {
      await transport().sendMail({
        from: process.env.SMTP_FROM || `Artiste <${process.env.SMTP_USER}>`,
        to: 'artiste.galleryindia@gmail.com',
        subject: `New open creative call entry · ${full_name}`,
        text: `A new creative entry has been submitted.\n\nName: ${full_name}\nEmail: ${email}\nPhone / WhatsApp: ${phone}\nCity: ${city}\nDiscipline: ${discipline}\nPortfolio: ${portfolio_url || 'Not supplied'}\n\nHow they would like to showcase themselves on Artiste:\n${showcase_vision}\n\nReview it in /studio-vault-owner → Open Creative Entries.\nEntry ID: ${data.id}`,
      });
      hostNotified = true;
      await supabase.from('creative_entries').update({ host_notified_at: new Date().toISOString() }).eq('id', data.id);
    } catch (mailError) { console.error('Creative entry saved, but Host alert email failed:', mailError.message); }
    return NextResponse.json({ ok: true, hostNotified, message: hostNotified ? 'Your entry has been received. Thank you for sharing your creative practice.' : 'Your entry has been safely received. The Host email alert needs attention.' }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not submit your entry.' }, { status: 400 }); }
}
export async function PATCH(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const body = await request.json();
    const id = String(body.id || '');
    const status = String(body.status || '');
    if (!/^[0-9a-f-]{20,40}$/i.test(id) || !['new','reviewing','contacted','converted','declined'].includes(status)) return NextResponse.json({ error: 'Invalid creative entry update.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data, error } = await supabase.from('creative_entries').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ entry: data });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not update creative entry.' }, { status: 400 }); }
}
