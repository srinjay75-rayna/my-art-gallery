import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRole } from '@/lib/supabase';
import {
  enforceRateLimit,
  rateLimitJsonResponse,
  readJsonBody,
} from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

const SESSION_COOKIE = 'artiste_portal_session';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function normalizeCreatorRole(value) {
  return String(value || '').trim().toLowerCase() === 'photographer'
    ? 'Photographer'
    : 'Painter';
}

function getPortalRole(accountType, creatorRole) {
  return accountType === 'customer'
    ? 'customer'
    : normalizeCreatorRole(creatorRole).toLowerCase();
}

function disciplineNotRegisteredMessage(role) {
  return `You are not registered as a ${role} yet. Please click New User — Sign Up above to create a separate ${role} account with its own password.`;
}

function verifyPassword(encoded, password) {
  try {
    const parts = String(encoded || '').split('$');

    if (
      parts.length !== 6 ||
      parts[0] !== 'scrypt'
    ) {
      return false;
    }

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);

    if (N !== 16384 || r !== 8 || p !== 1) {
      return false;
    }

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');

    if (
      salt.length !== 16 ||
      expected.length !== 64
    ) {
      return false;
    }

    const actual = crypto.scryptSync(
      String(password),
      salt,
      64,
      {
        N,
        r,
        p,
        maxmem: 64 * 1024 * 1024,
      }
    );

    return crypto.timingSafeEqual(
      actual,
      expected
    );

  } catch {
    return false;
  }
}

function createAnonClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase public URL and anon key are not configured.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/* ==========================================
   STRICT PORTAL MEMBERSHIP
========================================== */

async function getPortalProfile(
  supabase,
  email,
  accountType,
  creatorRole
) {
  if (accountType === 'customer') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  const role = normalizeCreatorRole(creatorRole);

  const { data, error } = await supabase
    .from('artists')
    .select('id,user_id,email,creator_role')
    .eq('email', email)
    .ilike('creator_role', role)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function findAuthUserForProfile(
  supabase,
  email,
  profile,
  accountType
) {
  const userId = accountType === 'customer'
    ? profile?.id
    : profile?.user_id;

  if (userId) {
    const { data, error } =
      await supabase.auth.admin.getUserById(userId);

    if (error) throw error;

    if (
      data?.user &&
      String(data.user.email || '').toLowerCase() === email
    ) {
      return data.user;
    }
  }

  // Fallback for legacy profiles without a usable Auth ID.

  for (let page = 1; page <= 200; page += 1) {
    const { data, error } =
      await supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

    if (error) throw error;

    const users = data?.users || [];

    const found = users.find(
      (candidate) =>
        String(candidate.email || '').toLowerCase() === email
    );

    if (found) return found;

    if (users.length < 1000) break;
  }

  return null;
}

/* ==========================================
   SIGNED SESSION COOKIE
========================================== */

function sessionSigningSecret() {
  const secret =
    process.env.AUTH_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error(
      'AUTH_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY is required to sign the portal session cookie.'
    );
  }

  return secret;
}

function internalAuthPassword(userId, email) {
  return crypto
    .createHmac('sha256', sessionSigningSecret())
    .update(
      `artiste-internal-auth-password-v1|${userId}|${email.toLowerCase()}`
    )
    .digest('hex');
}

function signPortalSessionCookie(
  established,
  accountType,
  creatorRole
) {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    version: 1,
    sub: established.user.id,
    email: established.user.email,
    account_type: accountType,

    ...(accountType === 'artist'
      ? {
          creator_role: normalizeCreatorRole(creatorRole),
        }
      : {}),

    session: established.session,
    iat: now,
    exp: now + SESSION_COOKIE_MAX_AGE,
  };

  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', sessionSigningSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

function attachPortalSessionCookie(
  response,
  established,
  accountType,
  creatorRole
) {
  response.cookies.set(
    SESSION_COOKIE,
    signPortalSessionCookie(
      established,
      accountType,
      creatorRole
    ),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE,
    }
  );

  return response;
}

/* ==========================================
   ISSUE VALID SUPABASE SESSION
========================================== */

async function issueSession(
  supabase,
  user,
  email,
  accountType,
  creatorRole
) {
  const metadata = {
    ...(user.user_metadata || {}),
    account_type: accountType,
    brand: 'Artiste',

    portal_accounts: [...new Set([
      ...(Array.isArray(user.user_metadata?.portal_accounts)
        ? user.user_metadata.portal_accounts.filter(
            (item) => ['customer', 'artist'].includes(item)
          )
        : []),
      accountType,
    ])],

    ...(accountType === 'artist'
      ? {
          creator_role: normalizeCreatorRole(creatorRole),
        }
      : {}),
  };

  // Independent user passwords have already been verified against
  // portal_credentials. Supabase Auth's own shared password is used
  // only as a private session issuer, never as a portal password.

  const internalPassword = internalAuthPassword(
    user.id,
    email
  );

  const appMetadata = {
    ...(user.app_metadata || {}),
    artiste_session_auth_version: 1,
  };

  const { data: updated, error: updateError } =
    await supabase.auth.admin.updateUserById(
      user.id,
      {
        password: internalPassword,
        email_confirm: true,
        user_metadata: metadata,
        app_metadata: appMetadata,
      }
    );

  if (updateError || !updated?.user) {
    throw updateError || new Error(
      'Could not prepare your secure Artiste session.'
    );
  }

  // Supabase password grant returns a valid access and refresh
  // token pair. No OTP verification or magic-link exchange.

  const { data: signedIn, error: signInError } =
    await createAnonClient().auth.signInWithPassword({
      email,
      password: internalPassword,
    });

  if (
    signInError ||
    !signedIn?.session ||
    !signedIn?.user
  ) {
    console.error(
      'Artiste internal session sign-in failed:',
      signInError?.message ||
      'Supabase did not return a session.'
    );

    throw signInError || new Error(
      'Could not establish your Artiste session.'
    );
  }

  return {
    session: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      expires_in: signedIn.session.expires_in,
      expires_at: signedIn.session.expires_at,
      token_type: signedIn.session.token_type,
    },

    user: {
      id: signedIn.user.id || user.id,
      email: signedIn.user.email || email,
      user_metadata: signedIn.user.user_metadata || metadata,
      email_confirmed_at:
        signedIn.user.email_confirmed_at ||
        new Date().toISOString(),
    },
  };
}

/* ==========================================
   POST /api/auth/login-password
========================================== */

export async function POST(request) {
  try {
    const rate = await enforceRateLimit(request, {
      scope: 'portal-password-login',
      limit: 12,
      windowSeconds: 15 * 60,
    });

    if (!rate.allowed) {
      return rateLimitJsonResponse(
        NextResponse,
        rate,
        'Too many sign-in attempts. Please wait before trying again.'
      );
    }

    const body = await readJsonBody(request, 8 * 1024);

    const email = String(body.email || '')
      .trim()
      .toLowerCase();

    const password = typeof body.password === 'string'
      ? body.password
      : '';

    const accountType = String(body.accountType || '')
      .trim()
      .toLowerCase();

    const creatorRole = normalizeCreatorRole(
      body.creatorRole
    );

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json(
        { error: 'Enter a valid email address.' },
        { status: 400 }
      );
    }

    if (!['customer', 'artist'].includes(accountType)) {
      return NextResponse.json(
        { error: 'Choose Customer or Artist sign-in.' },
        { status: 400 }
      );
    }

    if (
      password.length < MIN_PASSWORD ||
      password.length > MAX_PASSWORD
    ) {
      return NextResponse.json(
        {
          error: `Your password must contain ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
        },
        { status: 400 }
      );
    }

    const supabase = requireServiceRole();

    // First verify the exact portal profile.
    // This prevents Painter credentials from granting
    // Photographer access and vice versa.

    const profile = await getPortalProfile(
      supabase,
      email,
      accountType,
      creatorRole
    );

    if (!profile) {
      if (accountType === 'artist') {
        return NextResponse.json(
          {
            error: disciplineNotRegisteredMessage(creatorRole),
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: 'You are not registered as a Customer yet. Please click New User — Sign Up above to create a separate Customer account with its own password.',
        },
        { status: 404 }
      );
    }

    const user = await findAuthUserForProfile(
      supabase,
      email,
      profile,
      accountType
    );

    if (!user || !user.email_confirmed_at) {
      return NextResponse.json(
        {
          error: 'Your email has not been verified yet. Use email OTP verification to activate this portal.',
        },
        { status: 403 }
      );
    }

    const role = getPortalRole(
      accountType,
      creatorRole
    );

    const { data: credential, error: credentialError } =
      await supabase
        .from('portal_credentials')
        .select('password_hash')
        .eq('email', email)
        .eq('portal_role', role)
        .maybeSingle();

    if (credentialError) {
      console.error(
        'Artiste portal credential lookup failed:',
        credentialError.message
      );

      return NextResponse.json(
        {
          error: 'Independent portal passwords are not ready. Run database/schema.sql in Supabase.',
        },
        { status: 503 }
      );
    }

    // There is deliberately NO shared Supabase password fallback.
    // If this role has no password hash, the user must use Forgot Password
    // to create an independent password through email OTP.

    if (!credential?.password_hash) {
      return NextResponse.json(
        {
          error: 'No password has been set for this specific portal yet. Choose Forgot Password and verify your email to create its independent password.',
        },
        { status: 401 }
      );
    }

    if (!verifyPassword(credential.password_hash, password)) {
      return NextResponse.json(
        {
          error: 'Incorrect password for this portal. Use Forgot Password to reset it with an email code.',
        },
        { status: 401 }
      );
    }

    const established = await issueSession(
      supabase,
      user,
      email,
      accountType,
      creatorRole
    );

    const response = NextResponse.json({
      verified: true,
      accountType,

      creatorRole: accountType === 'artist'
        ? creatorRole
        : undefined,

      session: established.session,
      user: established.user,

      message: 'You are signed in to your selected Artiste portal.',
    });

    attachPortalSessionCookie(
      response,
      established,
      accountType,
      creatorRole
    );

    response.headers.set('Cache-Control', 'no-store');

    return response;

  } catch (error) {
    console.error(
      'Artiste password sign-in failed:',
      error?.stack || error?.message || error
    );

    const status = Number(error?.status);

    const responseStatus =
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? status
        : 500;

    return NextResponse.json(
      {
        error: responseStatus < 500
          ? error.message
          : 'Could not sign in right now. Please try email OTP verification.',
      },
      { status: responseStatus }
    );
  }
}
