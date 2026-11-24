import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function createEmailTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass) {
    throw new Error('SMTP email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.');
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    tls: { minVersion: 'TLSv1.2' },
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

function artistPortalUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.APP_URL;
  if (configured) return `${configured.replace(/\/+$/, '')}/artist`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/artist`;
  return 'http://localhost:3000/artist';
}

async function sendFoundingArtistWelcomeEmail({ email, fullName, studioName }) {
  const transport = createEmailTransport();
  const recipientName = String(fullName || studioName || 'Artist').trim();
  const portalUrl = artistPortalUrl();
  const from = process.env.SMTP_FROM || `Artiste <${process.env.SMTP_USER}>`;
  const subject = 'Welcome to the Artiste Founding Artist family';
  const text = `Dear ${recipientName},

We are delighted to let you know that your Founding Artist application has been approved. Welcome to the Artiste journey.

Your Artist account now receives the 80% Artist share. Please log in to your Artist Portal at ${portalUrl} to update your Studio Pickup Address and Bank / UPI Payout Details.

We are excited to share your work with collectors and look forward to building something meaningful together.

Warm regards,
Team Artiste`;
  const html = `<!doctype html><html><body style="margin:0;padding:32px;background:#f6f0e7;font-family:Arial,sans-serif;color:#263832"><div style="max-width:600px;margin:0 auto;background:#fffaf3;border:1px solid #e1d0b8;border-radius:18px;padding:32px"><p style="margin:0 0 16px;color:#9b644b;font-size:11px;letter-spacing:3px;text-transform:uppercase">Artiste · Founding Artist</p><h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:30px;font-weight:500">Welcome to the Artiste journey.</h1><p>Dear ${escapeHtml(recipientName)},</p><p>We are delighted to let you know that your <strong>Founding Artist application has been approved</strong>. Welcome to the Artiste family.</p><p>Your account now receives the <strong>80% Artist share</strong>. Your creative practice deserves to be seen, valued and supported, and we are excited to share your work with collectors.</p><p>Please log in to your Artist Portal to update your <strong>Studio Pickup Address</strong> and <strong>Bank / UPI Payout Details</strong>.</p><p style="margin:28px 0"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#173d31;color:#fffaf3;text-decoration:none;font-weight:bold">Open Artist Portal</a></p><p>We look forward to building something meaningful together.</p><p style="margin-bottom:0">Warm regards,<br/><strong>Team Artiste</strong></p></div></body></html>`;

  await transport.sendMail({ from, to: email, subject, text, html });
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const { data, error } = await supabase
      .from('artist_applications')
      .select('*')
      .in('application_status', ['Pending', 'Submitted', 'pending', 'submitted'])
      .order('created_at', { ascending: true });
    if (error) throw error;
    const applications = (data || []).map((application) => ({
      ...application,
      status: String(application.application_status || '').toLowerCase(),
    }));
    return NextResponse.json({ applications });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load applications.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id, decision } = await request.json();
    if (!id || !['approve', 'decline'].includes(decision)) {
      return NextResponse.json({ error: 'A valid application and decision are required.' }, { status: 400 });
    }

    const supabase = requireServiceRole();
    const { data: application, error: findError } = await supabase
      .from('artist_applications')
      .select('id,artist_id,user_id,email,full_name,studio_name,application_status')
      .eq('id', id)
      .maybeSingle();
    if (findError) throw findError;
    if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    const currentStatus = String(application.application_status || '').toLowerCase();
    if (!['pending', 'submitted'].includes(currentStatus)) {
      return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const status = decision === 'approve' ? 'approved' : 'declined';
    const { error: appError } = await supabase
      .from('artist_applications')
      .update({ application_status: status, updated_at: now })
      .eq('id', id);
    if (appError) throw appError;

    if (decision === 'decline') {
      return NextResponse.json({ success: true, status, emailSent: false, message: 'Application declined.' });
    }

    const { data: updatedArtist, error: artistError } = await supabase
      .from('artists')
      .update({ is_founding_artist: true, updated_at: now })
      .eq('id', application.artist_id)
      .select('id,email')
      .single();
    if (artistError) {
      // Revert the application state if the founder designation could not be saved.
      try {
        await supabase.from('artist_applications').update({ application_status: 'pending', updated_at: new Date().toISOString() }).eq('id', id);
      } catch {}
      throw artistError;
    }

    let recipient = String(application.email || updatedArtist.email || '').trim().toLowerCase();
    if (!recipient && application.user_id) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(application.user_id);
        recipient = String(authUser?.user?.email || '').trim().toLowerCase();
      } catch {}
    }

    let emailSent = false;
    let emailWarning = '';
    if (recipient) {
      try {
        await sendFoundingArtistWelcomeEmail({
          email: recipient,
          fullName: application.full_name,
          studioName: application.studio_name,
        });
        emailSent = true;
      } catch (emailError) {
        console.error('Founding Artist approval email failed:', emailError?.message || emailError);
        emailWarning = 'The Artist is approved, but the welcome email could not be delivered. Check SMTP configuration and send the welcome email manually.';
      }
    } else {
      emailWarning = 'The Artist is approved, but no verified applicant email was found for this application.';
    }

    return NextResponse.json({
      success: true,
      status,
      emailSent,
      message: emailSent
        ? 'Approved as Founding Artist with 80% share. A welcome email has been sent.'
        : `Approved as Founding Artist with 80% share. ${emailWarning}`,
      ...(emailWarning ? { emailWarning } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not review application.' }, { status: 400 });
  }
}
