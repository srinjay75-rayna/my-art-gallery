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
  return 'https://my-art-gallery-theta.vercel.app/artist';
}

async function sendFoundingArtistWelcomeEmail({ email, fullName, studioName, approvalTier }) {
  const transport = createEmailTransport();
  const recipientName = String(fullName || studioName || 'Artist').trim();
  const portalUrl = artistPortalUrl();
  const from = process.env.SMTP_FROM || `Artiste <${process.env.SMTP_USER}>`;
  const artistShare = approvalTier === '80/20' ? 80 : 75;
  const platformShare = 100 - artistShare;
  const tierName = approvalTier === '80/20' ? 'Founding Artist' : 'Artiste Artist';
  const subject = `Welcome to Artiste · ${artistShare}% Artist share`;
  const text = `Dear ${recipientName},

Your Artist application has been approved. Welcome to the Artiste journey.

Your assigned tier is ${approvalTier}: ${artistShare}% Artist share and ${platformShare}% Platform commission. Payout is released 48 hours after courier delivery is marked Delivered, subject to verified payout details.

Please log in to your Artist Portal at ${portalUrl} to complete your Name, Studio Pickup Address and Bank / UPI details. Pack each confirmed sale and have it ready for collection within 72 hours of order confirmation.

Warm regards,
Team Artiste`;
  const html = `<!doctype html><html><body style="margin:0;padding:32px;background:#f6f0e7;font-family:Arial,sans-serif;color:#263832"><div style="max-width:600px;margin:0 auto;background:#fffaf3;border:1px solid #e1d0b8;border-radius:18px;padding:32px"><p style="margin:0 0 16px;color:#9b644b;font-size:11px;letter-spacing:3px;text-transform:uppercase">Artiste · ${escapeHtml(tierName)}</p><h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:30px;font-weight:500">Welcome to the Artiste journey.</h1><p>Dear ${escapeHtml(recipientName)},</p><p>Your Artist application has been <strong>approved</strong>. Welcome to the Artiste family.</p><p>Your assigned commission tier is <strong>${approvalTier}</strong>: you receive <strong>${artistShare}% Artist share</strong>, with ${platformShare}% Platform commission.</p><p>Payout is released 48 hours after courier delivery is marked Delivered, subject to verified payout details.</p><p>Please log in to your Artist Portal to complete your <strong>Name</strong>, <strong>Studio Pickup Address</strong> and <strong>Bank / UPI details</strong>. Please have each confirmed sale ready for collection within <strong>72 hours of order confirmation</strong>.</p><p style="margin:28px 0"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#173d31;color:#fffaf3;text-decoration:none;font-weight:bold">Open Artist Portal</a></p><p style="margin-bottom:0">Warm regards,<br/><strong>Team Artiste</strong></p></div></body></html>`;
  await transport.sendMail({ from, to: email, subject, text, html });
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const data = [];
    for (let start = 0; ; start += 1000) {
      const { data: page, error } = await supabase
        .from('artist_applications')
        .select('*')
        .order('created_at', { ascending: true })
        .range(start, start + 999);
      if (error) throw error;
      data.push(...(page || []));
      if (!page || page.length < 1000) break;
    }
    const applications = data.map((application) => ({
      ...application,
      status: String(application.application_status || '').toLowerCase(),
    }));
    return NextResponse.json({
      applications: applications.filter((application) => ['pending', 'submitted'].includes(application.status)),
      approvedApplications: applications.filter((application) => application.status === 'approved'),
    });
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

    if (decision === 'decline') {
      const { error: declineError } = await supabase
        .from('artist_applications')
        .update({ application_status: 'declined', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (declineError) throw declineError;
      return NextResponse.json({ success: true, status: 'declined', emailSent: false, message: 'Application declined.' });
    }

    const { data: approvalResult, error: approvalError } = await supabase.rpc('artiste_approve_founding_application', {
      p_application_id: id,
    });
    if (approvalError) throw new Error(`${approvalError.message}. Run the V17 section of database/schema.sql.`);

    const { data: updatedArtist, error: artistError } = await supabase
      .from('artists')
      .select('id,email')
      .eq('id', application.artist_id)
      .single();
    if (artistError) throw artistError;

    let recipient = String(application.email || updatedArtist.email || '').trim().toLowerCase();
    if (!recipient && application.user_id) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(application.user_id);
        recipient = String(authUser?.user?.email || '').trim().toLowerCase();
      } catch {}
    }

    const approvalTier = approvalResult?.approval_tier === '80/20' ? '80/20' : '75/25';
    const artistShare = approvalTier === '80/20' ? 80 : 75;
    let emailSent = false;
    let emailWarning = '';
    if (recipient) {
      try {
        await sendFoundingArtistWelcomeEmail({
          email: recipient,
          fullName: application.full_name,
          studioName: application.studio_name,
          approvalTier,
        });
        emailSent = true;
      } catch (emailError) {
        console.error('Artist approval email failed:', emailError?.message || emailError);
        emailWarning = 'The Artist is approved, but the welcome email could not be delivered. Check SMTP configuration and send the welcome email manually.';
      }
    } else {
      emailWarning = 'The Artist is approved, but no verified applicant email was found for this application.';
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      approvalTier,
      emailSent,
      message: emailSent
        ? `Approved with ${approvalTier} tier (${artistShare}% Artist share). A welcome email has been sent.`
        : `Approved with ${approvalTier} tier (${artistShare}% Artist share). ${emailWarning}`,
      ...(emailWarning ? { emailWarning } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not review application.' }, { status: 400 });
  }
}
