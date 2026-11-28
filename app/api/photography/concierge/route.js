import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireServiceRole } from '@/lib/supabase';
import { cleanText, enforceRateLimit } from '@/lib/request-guard';
export const runtime = 'nodejs';
export async function POST(request) {
  const rate = await enforceRateLimit(request, { scope: 'photography-concierge', limit: 5, windowSeconds: 3600 });
  if (!rate.allowed) return NextResponse.json({ error: 'Too many concierge requests. Please try again shortly.' }, { status: rate.unavailable ? 503 : 429 });
  try {
    const body = await request.json();
    const paintingId = String(body.painting_id || '');
    const fullName = cleanText(body.full_name, 120), email = cleanText(body.email, 180).toLowerCase();
    const phone = cleanText(body.phone, 30), inquiry = cleanText(body.inquiry, 2500);
    if (!/^[0-9a-f-]{20,40}$/i.test(paintingId) || fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || inquiry.length < 10) return NextResponse.json({ error: 'Please enter your name, a valid email and your commission details.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: painting, error: paintingError } = await supabase.from('paintings').select('id,title,artist_id,artist_name,category').eq('id', paintingId).eq('category', 'Photography').maybeSingle();
    if (paintingError) throw paintingError;
    if (!painting) return NextResponse.json({ error: 'Photography artwork not found.' }, { status: 404 });
    const { data, error } = await supabase.from('photography_concierge_inquiries').insert({ painting_id: painting.id, artist_id: painting.artist_id, artwork_title: painting.title, full_name: fullName, email, phone, inquiry }).select('*').single();
    if (error) throw error;
    let emailSent = false;
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT || 587), user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (host && user && pass && Number.isInteger(port)) {
      const tx = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
      await tx.sendMail({ from: process.env.SMTP_FROM || `Artiste <${user}>`, to: 'artiste.galleryindia@gmail.com', subject: `Grade V Royal 1-of-1 enquiry · ${painting.title}`, text: `New private concierge inquiry\nArtwork: ${painting.title}\nArtist: ${painting.artist_name}\nName: ${fullName}\nEmail: ${email}\nPhone: ${phone || 'Not supplied'}\n\nInquiry:\n${inquiry}\n\nRecord: ${data.id}` });
      emailSent = true;
    }
    return NextResponse.json({ ok: true, emailSent, message: 'Your private concierge inquiry has been recorded.' }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not submit the concierge inquiry.' }, { status: 400 }); }
}
