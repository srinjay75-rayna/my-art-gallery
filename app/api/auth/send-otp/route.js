import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { requireServiceRole } from '@/lib/supabase';
import {
  cleanText,
  enforceRateLimit,
  rateLimitJsonResponse,
  readJsonBody,
} from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ACCOUNT_TYPES = new Set(['customer', 'artist']);
const ALLOWED_PURPOSES = new Set(['login', 'signup']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCreatorRole(value) {
  return String(value || '').trim().toLowerCase() === 'photographer'
    ? 'Photographer'
    : 'Painter';
}

function portalDisciplineMessage(role) {
  return `You are not registered as a ${role} yet. Please click New User — Sign Up above to create a separate ${role} account with its own password.`;
}

function otpHash({ email, accountType, purpose, code }) {
  const key = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error('OTP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }

  return crypto
    .createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}

function hashIp(ip) {
  const key = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error('OTP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }

  return crypto
    .createHmac('sha256', key)
    .update(`ip|${ip || 'unknown'}`)
    .digest('hex');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user ||
    !pass
  ) {
    throw new Error(
      'Email delivery is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to the server environment.'
    );
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

async function requirePortalProfile(
  supabase,
  email,
  accountType,
  creatorRole
) {
  if (accountType === 'artist') {
    const { data, error } = await supabase
      .from('artists')
      .select('id')
      .eq('email', email)
      .ilike('creator_role', creatorRole)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const notFound = new Error(
        portalDisciplineMessage(creatorRole)
      );

      notFound.status = 404;
      throw notFound;
    }

    return data;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error(
      'You are not registered as a Customer yet. Please click New User — Sign Up above to create a separate Customer account with its own password.'
    );

    notFound.status = 404;
    throw notFound;
  }

  return data;
}

function safeClientError(error) {
  const status = Number(error?.status);

  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return error.message || 'The verification request could not be completed.';
  }

  if (
    error?.code === '42P01' ||
    /email_otps/i.test(String(error?.message || ''))
  ) {
    return 'The OTP database table is not ready. Run the database/schema.sql migration in Supabase.';
  }

  return 'We could not send your verification code right now. Please try again in a moment.';
}

export async function POST(request) {
  let otpRowId = null;

  try {
    const ipRate = await enforceRateLimit(request, {
      scope: 'otp-send',
      limit: 20,
      windowSeconds: 60 * 60,
    });

    if (!ipRate.allowed) {
      return rateLimitJsonResponse(
        NextResponse,
        ipRate,
        'Too many verification requests from this connection. Please try again later.'
      );
    }

    const body = await readJsonBody(request, 12 * 1024);

    const email = String(body.email || '').trim().toLowerCase();
    const accountType = String(body.accountType || '').trim().toLowerCase();
    const purpose = String(body.purpose || '').trim().toLowerCase();

    const name = cleanText(body.name, 100);

    const phoneDigits = String(body.phone || '')
      .replace(/\D/g, '')
      .replace(/^91/, '')
      .slice(-10);

    const creatorRole = normalizeCreatorRole(body.creatorRole);

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json(
        { error: 'Enter a valid email address.' },
        { status: 400 }
      );
    }

    if (
      !ALLOWED_ACCOUNT_TYPES.has(accountType) ||
      !ALLOWED_PURPOSES.has(purpose)
    ) {
      return NextResponse.json(
        { error: 'Invalid verification request.' },
        { status: 400 }
      );
    }

    if (purpose === 'signup') {
      if (name.length < 2 || name.length > 100) {
        return NextResponse.json(
          {
            error: accountType === 'artist'
              ? 'Enter your Artist or studio name.'
              : 'Enter your full name.',
          },
          { status: 400 }
        );
      }

      if (!/^\d{10}$/.test(phoneDigits)) {
        return NextResponse.json(
          { error: 'Enter a valid 10-digit Indian mobile number.' },
          { status: 400 }
        );
      }
    }

    const emailBurst = await enforceRateLimit(request, {
      scope: 'otp-send-email-30sec',
      identifier: email,
      limit: 1,
      windowSeconds: 30,
    });

    if (!emailBurst.allowed) {
      return rateLimitJsonResponse(
        NextResponse,
        emailBurst,
        'Please wait 30 seconds before requesting another code.'
      );
    }

    const emailHourly = await enforceRateLimit(request, {
      scope: 'otp-send-email-hour',
      identifier: email,
      limit: 5,
      windowSeconds: 60 * 60,
    });

    if (!emailHourly.allowed) {
      return rateLimitJsonResponse(
        NextResponse,
        emailHourly,
        'Too many codes have been requested for this email. Please try again later.'
      );
    }

    const supabase = requireServiceRole();

    // Strict login membership check.
    // Painter and Photographer are separate portal profiles.

    if (purpose === 'login') {
      try {
        await requirePortalProfile(
          supabase,
          email,
          accountType,
          creatorRole
        );
      } catch (error) {
        if (Number(error?.status) === 404) {
          return NextResponse.json(
            { error: error.message },
            { status: 404 }
          );
        }

        throw error;
      }
    }

    const now = Date.now();

    const hourAgo = new Date(
      now - 60 * 60 * 1000
    ).toISOString();

    // Remove expired OTP records periodically.

    try {
      await supabase
        .from('email_otps')
        .delete()
        .lt(
          'expires_at',
          new Date(now - 24 * 60 * 60 * 1000).toISOString()
        );
    } catch (cleanupError) {
      console.warn(
        'Artiste OTP cleanup skipped:',
        cleanupError?.message || cleanupError
      );
    }

    const ipHeader =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      '';

    const clientIp = ipHeader.split(',')[0].trim() || 'unknown';
    const ipHash = hashIp(clientIp);

    const [emailActivity, ipActivity] = await Promise.all([
      supabase
        .from('email_otps')
        .select('id,created_at')
        .eq('email', email)
        .gte('created_at', hourAgo)
        .order('created_at', { ascending: false })
        .limit(6),

      supabase
        .from('email_otps')
        .select('id')
        .eq('ip_hash', ipHash)
        .gte('created_at', hourAgo)
        .limit(21),
    ]);

    if (emailActivity.error) throw emailActivity.error;
    if (ipActivity.error) throw ipActivity.error;

    const recentEmail = emailActivity.data || [];
    const recentIp = ipActivity.data || [];

    if (recentEmail.length >= 5) {
      return NextResponse.json(
        {
          error: 'Too many codes have been requested for this email. Please try again later.',
        },
        { status: 429 }
      );
    }

    if (
      recentEmail[0]?.created_at &&
      now - new Date(recentEmail[0].created_at).getTime() < 30000
    ) {
      return NextResponse.json(
        {
          error: 'Please wait 30 seconds before requesting another code.',
        },
        {
          status: 429,
          headers: { 'Retry-After': '30' },
        }
      );
    }

    if (recentIp.length >= 20) {
      return NextResponse.json(
        {
          error: 'Too many verification requests from this connection. Please try again later.',
        },
        { status: 429 }
      );
    }

    // Invalidate previous unused codes for this email, portal and flow.

    const { error: invalidateError } = await supabase
      .from('email_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('email', email)
      .eq('account_type', accountType)
      .eq('purpose', purpose)
      .is('used_at', null);

    if (invalidateError) throw invalidateError;

    const code = String(
      crypto.randomInt(100000, 1000000)
    );

    const expiresAt = new Date(
      now + 10 * 60 * 1000
    ).toISOString();

    // Persist the selected discipline for both signup and login.
    // This prevents an OTP requested for Painter from being used
    // to enter the Photographer portal.

    const metadata = {
      account_type: accountType,
      brand: 'Artiste',

      ...(accountType === 'artist'
        ? { creator_role: creatorRole }
        : {}),

      ...(purpose === 'signup'
        ? accountType === 'artist'
          ? {
              artist_name: name,
              full_name: name,
              phone: `+91${phoneDigits}`,
            }
          : {
              full_name: name,
              phone: `+91${phoneDigits}`,
            }
        : {}),
    };

    const { data: inserted, error: insertError } =
      await supabase
        .from('email_otps')
        .insert({
          email,
          account_type: accountType,
          purpose,
          otp_hash: otpHash({
            email,
            accountType,
            purpose,
            code,
          }),
          metadata,
          expires_at: expiresAt,
          attempts: 0,
          ip_hash: ipHash,
        })
        .select('id')
        .single();

    if (insertError) throw insertError;

    otpRowId = inserted.id;

    const transporter = createTransport();

    const from =
      process.env.SMTP_FROM ||
      `Artiste Verification <${process.env.SMTP_USER}>`;

    const portalName = accountType === 'artist'
      ? `${creatorRole} Portal`
      : 'Customer Account';

    const safeName = purpose === 'signup'
      ? escapeHtml(name)
      : 'there';

    await transporter.sendMail({
      from,
      to: email,
      subject: `${code} is your Artiste verification code`,

      text: `Hello ${purpose === 'signup' ? name : 'there'},

Your Artiste ${portalName} verification code is ${code}.

This code expires in 10 minutes and can be used only once. Enter it on the Artiste website. Do not share this code with anyone.

If you did not request this code, you can ignore this email.

Artiste Support`,

      html: `<!doctype html>
<html>
<body style="margin:0;background:#f6f1e9;font-family:Arial,sans-serif;color:#2e2924;padding:28px 12px">
<div style="max-width:520px;margin:0 auto;background:#F3ECE1;border:1px solid #e6ddd1;border-radius:18px;padding:32px">
<div style="font-family:Georgia,serif;font-size:26px;letter-spacing:.08em">Artiste</div>
<p style="color:#756b60;font-size:13px;margin:22px 0 8px">
${safeName === 'there' ? 'Your secure verification code' : `Hello ${safeName},`}
</p>
<h1 style="font-size:22px;font-weight:500;margin:0">Confirm your email</h1>
<p style="font-size:14px;line-height:1.6;color:#756b60">
Use this 6-digit code to continue to your ${portalName.toLowerCase()}.
You do not need to open a link or leave your current browser tab.
</p>
<div style="margin:26px 0;padding:18px;background:#f4e9dc;border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:10px">
${code}
</div>
<p style="font-size:12px;line-height:1.6;color:#756b60">
This code expires in <strong>10 minutes</strong> and can be used only once.
Never share it with anyone, including Artiste support.
</p>
<hr style="border:0;border-top:1px solid #eee5d9;margin:24px 0">
<p style="font-size:11px;color:#93897e">
If you did not request this code, you can safely ignore this email.
</p>
</div>
</body>
</html>`,
    });

    return NextResponse.json({
      sent: true,
      expiresInSeconds: 600,
      resendAfterSeconds: 30,
      message: 'A 6-digit code has been sent to your email.',
    });

  } catch (error) {
    if (otpRowId) {
      try {
        await requireServiceRole()
          .from('email_otps')
          .update({ used_at: new Date().toISOString() })
          .eq('id', otpRowId);
      } catch (cleanupError) {
        console.warn(
          'Artiste failed to invalidate undelivered OTP:',
          cleanupError?.message || cleanupError
        );
      }
    }

    console.error(
      'Artiste send OTP error:',
      error?.stack || error?.message || error
    );

    const status = Number(error?.status);

    const responseStatus =
      Number.isInteger(status) && status >= 400 && status < 600
        ? status
        : 500;

    return NextResponse.json(
      { error: safeClientError(error) },
      { status: responseStatus }
    );
  }
}
