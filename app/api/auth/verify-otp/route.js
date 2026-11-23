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

const ALLOWED_ACCOUNT_TYPES = new Set(['customer', 'artist']);
const ALLOWED_PURPOSES = new Set(['login', 'signup']);

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

function otpHash({ email, accountType, purpose, code }) {
  const key =
    process.env.OTP_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error('OTP_HASH_SECRET is not configured on the server.');
  }

  return crypto
    .createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);

  const derived = crypto.scryptSync(
    String(password),
    salt,
    64,
    {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }
  );

  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function savePortalPassword(
  supabase,
  email,
  accountType,
  creatorRole,
  password
) {
  if (!password) return;

  const { error } = await supabase
    .from('portal_credentials')
    .upsert({
      email: email.toLowerCase(),
      portal_role: getPortalRole(accountType, creatorRole),
      password_hash: passwordHash(password),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'email,portal_role',
    });

  if (error) {
    console.error(
      'Artiste portal credential save failed:',
      error.message
    );

    const issue = new Error(
      'Your portal password could not be saved. Run the V13 database/schema.sql migration and try again.'
    );

    issue.status = 503;
    throw issue;
  }
}

function httpStatus(error, fallback = 400) {
  const status = Number(error?.status);

  return Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : fallback;
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isEmailExistsError(error) {
  return (
    error?.code === 'email_exists' ||
    error?.code === 'user_already_exists' ||
    /already (been )?registered|already exists|email_exists/i.test(
      String(error?.message || '')
    )
  );
}

async function findExistingAuthUserByEmail(supabase, email) {
  const profileLookups = await Promise.all([
    supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(2),

    supabase
      .from('artists')
      .select('user_id')
      .eq('email', email)
      .limit(8),
  ]);

  for (const result of profileLookups) {
    if (result.error) {
      console.warn(
        'Artiste profile email lookup skipped:',
        result.error.message
      );
      continue;
    }

    for (const row of result.data || []) {
      const id = row.id || row.user_id;
      if (!id) continue;

      const { data, error } =
        await supabase.auth.admin.getUserById(id);

      if (
        !error &&
        String(data?.user?.email || '').toLowerCase() === email
      ) {
        return data.user;
      }
    }
  }

  // The Auth identity is shared by all portal roles.
  // Actual portal membership is checked separately in profiles/artists.

  const perPage = 1000;

  for (let page = 1; page <= 200; page += 1) {
    const { data, error } =
      await supabase.auth.admin.listUsers({
        page,
        perPage,
      });

    if (error) throw error;

    const users = data?.users || [];

    const match = users.find(
      (candidate) =>
        String(candidate.email || '').toLowerCase() === email
    );

    if (match) return match;
    if (users.length < perPage) return null;
  }

  throw new Error(
    'Could not complete the account lookup. Please try again.'
  );
}

async function getPortalProfile(
  supabase,
  email,
  accountType,
  creatorRole = 'Painter'
) {
  if (accountType === 'artist') {
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

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function ensureLegacyCustomerProfile(
  supabase,
  user,
  email
) {
  if (
    user.user_metadata?.account_type !== 'customer' ||
    user.user_metadata?.brand !== 'Artiste'
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      email,
      full_name: String(
        user.user_metadata?.full_name || ''
      ).slice(0, 100),
      phone: String(
        user.user_metadata?.phone || ''
      ).slice(0, 20),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id',
    })
    .select('id,email')
    .single();

  if (error) throw error;

  return data || null;
}

async function createCustomerProfile(
  supabase,
  user,
  payload,
  email
) {
  const fullName = String(
    payload.full_name ||
    payload.artist_name ||
    'Customer'
  )
    .trim()
    .slice(0, 100);

  const phone = String(
    payload.phone || ''
  )
    .trim()
    .slice(0, 20);

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      email,
      full_name: fullName,
      phone,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id',
    });

  if (error) throw error;
}

async function createArtistDraft(
  supabase,
  user,
  payload,
  email,
  creatorRole
) {
  const artistName = String(
    payload.artist_name ||
    payload.full_name ||
    'Artist'
  )
    .trim()
    .slice(0, 100) || 'Artist';

  const phone = String(
    payload.phone || ''
  )
    .trim()
    .slice(0, 20);

  const { error } = await supabase
    .from('artists')
    .upsert({
      user_id: user.id,
      email,
      phone,
      artist_name: artistName,
      creator_role: creatorRole,
      bio: '',
      city: '',
      state: '',
      pickup_address: '',
      pickup_contact_name: artistName,
      pickup_phone: phone,
      pickup_landmark: '',
      pickup_locality: '',
      pickup_pincode: '',
      pickup_location: 'Primary',
      approved: false,
      is_approved: false,
      is_suspended: false,
    }, {
      onConflict: 'user_id,creator_role',
    });

  if (error) throw error;
}

function portalAccountsFor(user, accountType) {
  return [...new Set([
    ...(Array.isArray(user?.user_metadata?.portal_accounts)
      ? user.user_metadata.portal_accounts.filter(
          (type) => ALLOWED_ACCOUNT_TYPES.has(type)
        )
      : []),
    accountType,
  ])];
}

function duplicatePortalError(accountType, creatorRole) {
  const label = accountType === 'customer'
    ? 'Customer'
    : normalizeCreatorRole(creatorRole);

  return statusError(
    `A ${label} profile already exists for this email. Choose Existing User — Log In and select that portal.`,
    409
  );
}

function safeMessage(error) {
  const value = String(
    error?.message ||
    'Authentication could not be completed.'
  );

  if (
    /already registered|already been registered|user already exists|email_exists/i.test(value)
  ) {
    return 'This exact Artiste portal already exists for this email. Choose Existing User — Log In.';
  }

  if (Number(error?.status) >= 500) {
    return value.includes('V13 database/schema.sql')
      ? value
      : 'Something went wrong while verifying your code. Please try again.';
  }

  return value;
}

function createSessionClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase public URL and anon key are not configured on the server.'
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
   SIGNED HTTP-ONLY SESSION COOKIE
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
   SUPABASE SESSION ISSUANCE

   The custom 6-digit OTP has already been verified
   against public.email_otps. We do NOT call
   supabase.auth.verifyOtp() for that code.
========================================== */

async function mintUserSession(
  supabase,
  email,
  user,
  accountType,
  creatorRole
) {
  const metadata = {
    ...(user.user_metadata || {}),
    account_type: accountType,
    brand: 'Artiste',
    portal_accounts: portalAccountsFor(user, accountType),

    ...(accountType === 'artist'
      ? {
          creator_role: normalizeCreatorRole(creatorRole),
        }
      : {}),
  };

  // Supabase Auth has one shared identity per email.
  // Portal passwords are independently checked against
  // salted hashes in public.portal_credentials.
  //
  // This internal deterministic password is only used to
  // obtain a legitimate Supabase access/refresh session.
  // It is never shown to or supplied by the customer.

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

  // Obtain valid Supabase tokens through the password grant.
  // No custom OTP or magic-link verification is involved.

  const { data: signedIn, error: signInError } =
    await createSessionClient().auth.signInWithPassword({
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
   POST /api/auth/verify-otp
========================================== */

export async function POST(request) {
  try {
    const rate = await enforceRateLimit(request, {
      scope: 'otp-verify',
      limit: 40,
      windowSeconds: 15 * 60,
    });

    if (!rate.allowed) {
      return rateLimitJsonResponse(
        NextResponse,
        rate,
        'Too many verification attempts. Please wait before trying again.'
      );
    }

    const body = await readJsonBody(request, 8 * 1024);

    const email = String(body.email || '')
      .trim()
      .toLowerCase();

    const accountType = String(body.accountType || '')
      .trim()
      .toLowerCase();

    const requestedCreatorRole = normalizeCreatorRole(
      body.creatorRole
    );

    const purpose = String(body.purpose || '')
      .trim()
      .toLowerCase();

    const code = String(body.otp || '').trim();

    const requestedPassword =
      typeof body.password === 'string'
        ? body.password
        : '';

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

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Enter the 6-digit code from your email.' },
        { status: 400 }
      );
    }

    if (
      (purpose === 'signup' || requestedPassword) &&
      requestedPassword.length < MIN_PASSWORD
    ) {
      return NextResponse.json(
        {
          error: `Your password must contain at least ${MIN_PASSWORD} characters.`,
        },
        { status: 400 }
      );
    }

    if (requestedPassword.length > MAX_PASSWORD) {
      return NextResponse.json(
        {
          error: `Your password must not be longer than ${MAX_PASSWORD} characters.`,
        },
        { status: 400 }
      );
    }

    const supabase = requireServiceRole();

    // IMPORTANT:
    // The user's custom six-digit code is consumed ONLY by the
    // server-side email_otps RPC. No Supabase Auth OTP verification.

    const { data: consumed, error: consumeError } =
      await supabase.rpc('consume_email_otp', {
        p_email: email,
        p_account_type: accountType,
        p_purpose: purpose,
        p_otp_hash: otpHash({
          email,
          accountType,
          purpose,
          code,
        }),
      });

    if (consumeError) {
      console.error(
        'Artiste consume OTP error:',
        consumeError.message
      );

      return NextResponse.json(
        {
          error: 'The OTP verification database function is unavailable. Run database/schema.sql in Supabase.',
        },
        { status: 503 }
      );
    }

    const result = Array.isArray(consumed)
      ? consumed[0]
      : consumed;

    if (!result?.is_valid) {
      return NextResponse.json(
        {
          error: 'That code is invalid, expired, or already used. Request a new 6-digit code.',
        },
        { status: 400 }
      );
    }

    const payload =
      result.payload && typeof result.payload === 'object'
        ? result.payload
        : {};

    if (
      payload.account_type &&
      payload.account_type !== accountType
    ) {
      return NextResponse.json(
        {
          error: 'The verification request does not match this portal.',
        },
        { status: 400 }
      );
    }

    let activeCreatorRole = accountType === 'artist'
      ? normalizeCreatorRole(
          payload.creator_role || requestedCreatorRole
        )
      : null;

    // Bind the OTP to the discipline chosen when it was sent.
    if (
      accountType === 'artist' &&
      payload.creator_role &&
      normalizeCreatorRole(payload.creator_role) !== requestedCreatorRole
    ) {
      return NextResponse.json(
        {
          error: 'Your selected discipline changed after the code was sent. Request a new verification code.',
        },
        { status: 400 }
      );
    }

    let user = null;
    let reusedAuthUser = false;

    /* ======================================
       NEW USER SIGN-UP
    ====================================== */

    if (purpose === 'signup') {
      if (
        accountType === 'artist' &&
        !['Painter', 'Photographer'].includes(activeCreatorRole)
      ) {
        return NextResponse.json(
          {
            error: 'Choose Painter or Photographer before creating your account.',
          },
          { status: 400 }
        );
      }

      const accountMetadata = accountType === 'artist'
        ? {
            ...payload,
            account_type: 'artist',
            creator_role: activeCreatorRole,
            brand: 'Artiste',
          }
        : {
            ...payload,
            account_type: 'customer',
            brand: 'Artiste',
          };

      // Reuse one Supabase Auth identity for the email.
      // Each individual portal has its own password hash.

      const generatedAuthPassword = crypto
        .randomBytes(36)
        .toString('base64url');

      const createResult = await supabase.auth.admin.createUser({
        email,
        password: generatedAuthPassword,
        email_confirm: true,
        user_metadata: accountMetadata,
      });

      if (
        !createResult.error &&
        createResult.data?.user
      ) {
        user = createResult.data.user;
      } else {
        if (!isEmailExistsError(createResult.error)) {
          throw createResult.error || new Error(
            'Could not create your Artiste account.'
          );
        }

        user = await findExistingAuthUserByEmail(
          supabase,
          email
        );

        if (!user) throw createResult.error;

        reusedAuthUser = true;

        const existingProfile = await getPortalProfile(
          supabase,
          email,
          accountType,
          activeCreatorRole
        );

        if (existingProfile) {
          throw duplicatePortalError(
            accountType,
            activeCreatorRole
          );
        }
      }

      if (accountType === 'customer') {
        await createCustomerProfile(
          supabase,
          user,
          payload,
          email
        );
      } else {
        await createArtistDraft(
          supabase,
          user,
          payload,
          email,
          activeCreatorRole
        );
      }

      // Save a separate salted password hash for this portal.
      await savePortalPassword(
        supabase,
        email,
        accountType,
        activeCreatorRole,
        requestedPassword
      );

      const nextMetadata = {
        ...(user.user_metadata || {}),
        ...accountMetadata,
        account_type: accountType,
        portal_accounts: portalAccountsFor(
          user,
          accountType
        ),
        brand: 'Artiste',

        ...(accountType === 'artist'
          ? { creator_role: activeCreatorRole }
          : {}),
      };

      const metadataUpdate =
        await supabase.auth.admin.updateUserById(
          user.id,
          {
            email_confirm: true,
            user_metadata: nextMetadata,
          }
        );

      if (
        metadataUpdate.error ||
        !metadataUpdate.data?.user
      ) {
        throw metadataUpdate.error || new Error(
          'Could not confirm your Artiste account.'
        );
      }

      user = metadataUpdate.data.user;

    } else {

      /* ======================================
         EXISTING USER — OTP LOGIN / RESET
      ====================================== */

      user = await findExistingAuthUserByEmail(
        supabase,
        email
      );

      if (!user) {
        if (accountType === 'artist') {
          return NextResponse.json(
            {
              error: disciplineNotRegisteredMessage(activeCreatorRole),
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

      let portalProfile = await getPortalProfile(
        supabase,
        email,
        accountType,
        activeCreatorRole
      );

      if (
        !portalProfile &&
        accountType === 'customer'
      ) {
        portalProfile = await ensureLegacyCustomerProfile(
          supabase,
          user,
          email
        );
      }

      if (!portalProfile) {
        if (accountType === 'artist') {
          return NextResponse.json(
            {
              error: disciplineNotRegisteredMessage(activeCreatorRole),
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

      if (accountType === 'artist') {
        activeCreatorRole = normalizeCreatorRole(
          portalProfile.creator_role
        );
      }

      // A password submitted in the reset flow updates only the
      // selected portal's independent password hash.

      if (requestedPassword) {
        await savePortalPassword(
          supabase,
          email,
          accountType,
          activeCreatorRole,
          requestedPassword
        );
      }

      const nextMetadata = {
        ...(user.user_metadata || {}),
        account_type: accountType,
        portal_accounts: portalAccountsFor(
          user,
          accountType
        ),
        brand: 'Artiste',

        ...(accountType === 'artist'
          ? { creator_role: activeCreatorRole }
          : {}),
      };

      const updateResult =
        await supabase.auth.admin.updateUserById(
          user.id,
          {
            user_metadata: nextMetadata,

            ...(user.email_confirmed_at
              ? {}
              : { email_confirm: true }),
          }
        );

      if (
        updateResult.error ||
        !updateResult.data?.user
      ) {
        throw updateResult.error || new Error(
          'Could not update your Artiste account.'
        );
      }

      user = updateResult.data.user;
    }

    /* ======================================
       ISSUE SUPABASE SESSION + HTTP-ONLY COOKIE
    ====================================== */

    const established = await mintUserSession(
      supabase,
      email,
      user,
      accountType,
      activeCreatorRole
    );

    const roleName = accountType === 'customer'
      ? 'Customer'
      : activeCreatorRole;

    const response = NextResponse.json({
      verified: true,
      accountType,

      creatorRole: accountType === 'artist'
        ? activeCreatorRole
        : undefined,

      reusedAuthUser,

      message:
        purpose === 'signup'
          ? `${roleName} profile created. Your portal has its own independent password.`
          : requestedPassword
            ? `Your ${roleName} portal password has been updated.`
            : `Your ${roleName} portal email is verified and you are signed in.`,

      // Existing EmailOtpAuth.js uses these tokens with setSession().
      // Retained for compatibility with the current V13 frontend.
      session: established.session,
      user: established.user,
    });

    attachPortalSessionCookie(
      response,
      established,
      accountType,
      activeCreatorRole
    );

    response.headers.set('Cache-Control', 'no-store');

    return response;

  } catch (error) {
    console.error(
      'Artiste verify OTP error:',
      error?.stack || error?.message || error
    );

    return NextResponse.json(
      { error: safeMessage(error) },
      { status: httpStatus(error, 500) }
    );
  }
}
