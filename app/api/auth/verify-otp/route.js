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

function normalizeCreatorRole(value) {
  return value === 'Photographer' ? 'Photographer' : 'Painter';
}

function portalRole(accountType, creatorRole) {
  if (accountType === 'customer') return 'customer';
  return normalizeCreatorRole(creatorRole).toLowerCase();
}

function otpHash({ email, accountType, purpose, code }) {
  const key = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('OTP_HASH_SECRET is not configured on the server.');
  return crypto.createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(
    String(password),
    salt,
    64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
  );
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function savePortalPassword(supabase, email, accountType, creatorRole, password) {
  if (!password) return;
  const { error } = await supabase.from('portal_credentials').upsert({
    email: email.toLowerCase(),
    portal_role: portalRole(accountType, creatorRole),
    password_hash: passwordHash(password),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'email,portal_role' });

  if (error) {
    console.error('Artiste portal credential save failed:', error.message);
    const issue = new Error('Your portal password could not be saved. Run the V13 database/schema.sql migration and try again.');
    issue.status = 503;
    throw issue;
  }
}

function httpStatus(error, fallback = 400) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599
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
    /already (been )?registered|already exists|email_exists/i.test(String(error?.message || ''))
  );
}

async function findExistingAuthUserByEmail(supabase, email) {
  const profileLookups = await Promise.all([
    supabase.from('profiles').select('id').eq('email', email).limit(2),
    supabase.from('artists').select('user_id').eq('email', email).limit(4),
  ]);

  for (const result of profileLookups) {
    if (result.error) {
      console.warn('Artiste profile email lookup skipped:', result.error.message);
      continue;
    }

    for (const row of result.data || []) {
      const id = row.id || row.user_id;
      if (!id) continue;
      const { data, error } = await supabase.auth.admin.getUserById(id);
      if (!error && String(data?.user?.email || '').toLowerCase() === email) {
        return data.user;
      }
    }
  }

  const perPage = 1000;
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((candidate) => String(candidate.email || '').toLowerCase() === email);
    if (match) return match;
    if (users.length < perPage) return null;
  }

  throw new Error('Could not complete the account lookup. Please try again.');
}

async function getPortalProfile(supabase, userId, accountType, creatorRole = 'Painter') {
  if (accountType === 'artist') {
    const role = normalizeCreatorRole(creatorRole);
    const result = await supabase
      .from('artists')
      .select('id,creator_role')
      .eq('user_id', userId)
      .eq('creator_role', role)
      .maybeSingle();

    if (result.error) throw result.error;
    if (result.data) return result.data;

    // Backward compatibility for legacy Painter rows created before
    // creator_role became non-null.
    if (role === 'Painter') {
      const legacy = await supabase
        .from('artists')
        .select('id,creator_role')
        .eq('user_id', userId)
        .is('creator_role', null)
        .maybeSingle();

      if (legacy.error) throw legacy.error;
      return legacy.data || null;
    }

    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function ensureLegacyCustomerProfile(supabase, user, email) {
  if (
    user.user_metadata?.account_type !== 'customer' ||
    user.user_metadata?.brand !== 'Artiste'
  ) {
    return null;
  }

  const { data, error } = await supabase.from('profiles').upsert({
    id: user.id,
    email,
    full_name: String(user.user_metadata?.full_name || '').slice(0, 100),
    phone: String(user.user_metadata?.phone || '').slice(0, 20),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select('id').single();

  if (error) throw error;
  return data || null;
}

async function createCustomerProfile(supabase, user, payload, email) {
  const fullName = String(payload.full_name || payload.artist_name || 'Customer')
    .trim()
    .slice(0, 100);
  const phone = String(payload.phone || '').trim().slice(0, 20);

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    email,
    full_name: fullName,
    phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) throw error;
}

async function createArtistDraft(supabase, user, payload, email, creatorRole) {
  const artistName = String(
    payload.artist_name || payload.full_name || 'Artist'
  ).trim().slice(0, 100) || 'Artist';

  const phone = String(payload.phone || '').trim().slice(0, 20);

  const { error } = await supabase.from('artists').upsert({
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
  }, { onConflict: 'user_id,creator_role' });

  if (error) throw error;
}

function portalAccountsFor(user, accountType) {
  return [...new Set([
    ...(Array.isArray(user?.user_metadata?.portal_accounts)
      ? user.user_metadata.portal_accounts.filter((type) => ALLOWED_ACCOUNT_TYPES.has(type))
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
  const value = String(error?.message || 'Authentication could not be completed.');

  if (/already registered|already been registered|user already exists|email_exists/i.test(value)) {
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase public URL and anon key are not configured on the server.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function mintUserSession(supabase, email, user) {
  const sessionLink = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (sessionLink.error || !sessionLink.data?.user) {
    throw sessionLink.error || new Error('Could not issue a sign-in session for this account.');
  }

  const tokenHash =
    sessionLink.data?.properties?.hashed_token ||
    sessionLink.data?.hashed_token;

  if (!tokenHash) {
    throw new Error('Supabase did not issue a sign-in session. Check your Auth configuration.');
  }

  const { data: verified, error: verifyError } =
    await createSessionClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });

  if (verifyError || !verified?.session) {
    throw verifyError || new Error('Could not establish your Artiste session.');
  }

  return {
    session: {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      expires_in: verified.session.expires_in,
      expires_at: verified.session.expires_at,
      token_type: verified.session.token_type,
    },
    user: {
      id: verified.user?.id || user.id,
      email: verified.user?.email || email,
      user_metadata: verified.user?.user_metadata || user.user_metadata || {},
      email_confirmed_at:
        verified.user?.email_confirmed_at ||
        user.email_confirmed_at ||
        new Date().toISOString(),
    },
  };
}

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
    const email = String(body.email || '').trim().toLowerCase();
    const accountType = String(body.accountType || '').trim().toLowerCase();
    const creatorRole = normalizeCreatorRole(body.creatorRole);
    const purpose = String(body.purpose || '').trim().toLowerCase();
    const code = String(body.otp || '').trim();
    const requestedPassword =
      typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    if (!ALLOWED_ACCOUNT_TYPES.has(accountType) || !ALLOWED_PURPOSES.has(purpose)) {
      return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 });
    }

    if ((purpose === 'signup' || requestedPassword) && requestedPassword.length < MIN_PASSWORD) {
      return NextResponse.json({
        error: `Your password must contain at least ${MIN_PASSWORD} characters.`,
      }, { status: 400 });
    }

    if (requestedPassword.length > MAX_PASSWORD) {
      return NextResponse.json({
        error: `Your password must not be longer than ${MAX_PASSWORD} characters.`,
      }, { status: 400 });
    }

    const supabase = requireServiceRole();

    const { data: consumed, error: consumeError } = await supabase.rpc(
      'consume_email_otp',
      {
        p_email: email,
        p_account_type: accountType,
        p_purpose: purpose,
        p_otp_hash: otpHash({ email, accountType, purpose, code }),
      }
    );

    if (consumeError) {
      console.error('Artiste consume OTP error:', consumeError.message);
      return NextResponse.json({
        error: 'The OTP verification database function is unavailable. Run database/schema.sql in Supabase.',
      }, { status: 503 });
    }

    const result = Array.isArray(consumed) ? consumed[0] : consumed;

    if (!result?.is_valid) {
      return NextResponse.json({
        error: 'That code is invalid, expired, or already used. Request a new 6-digit code.',
      }, { status: 400 });
    }

    let user = null;
    let reusedAuthUser = false;
    let activeCreatorRole = creatorRole;

    if (purpose === 'signup') {
      const payload = result.payload && typeof result.payload === 'object'
        ? result.payload
        : {};

      if (payload.account_type !== accountType) {
        return NextResponse.json({
          error: 'The verification request does not match this portal.',
        }, { status: 400 });
      }

      activeCreatorRole = accountType === 'artist'
        ? normalizeCreatorRole(payload.creator_role || creatorRole)
        : null;

      if (
        accountType === 'artist' &&
        body.creatorRole &&
        normalizeCreatorRole(body.creatorRole) !== activeCreatorRole
      ) {
        return NextResponse.json({
          error: 'Your selected discipline changed after the code was sent. Request a new verification code.',
        }, { status: 400 });
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

      // Supabase Auth maintains one email identity. This generated password
      // is never shown to the user; role-specific passwords are salted hashes
      // stored in the private portal_credentials table.
      const generatedAuthPassword = crypto.randomBytes(36).toString('base64url');

      const createResult = await supabase.auth.admin.createUser({
        email,
        password: generatedAuthPassword,
        email_confirm: true,
        user_metadata: accountMetadata,
      });

      if (!createResult.error && createResult.data?.user) {
        user = createResult.data.user;
      } else {
        if (!isEmailExistsError(createResult.error)) {
          throw createResult.error || new Error('Could not create your Artiste account.');
        }

        user = await findExistingAuthUserByEmail(supabase, email);
        if (!user) throw createResult.error;

        reusedAuthUser = true;

        const existingProfile = await getPortalProfile(
          supabase,
          user.id,
          accountType,
          activeCreatorRole
        );

        if (existingProfile) {
          throw duplicatePortalError(accountType, activeCreatorRole);
        }
      }

      if (accountType === 'customer') {
        await createCustomerProfile(supabase, user, payload, email);
      } else {
        await createArtistDraft(
          supabase,
          user,
          payload,
          email,
          activeCreatorRole
        );
      }

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
        portal_accounts: portalAccountsFor(user, accountType),
        brand: 'Artiste',
        ...(accountType === 'artist'
          ? { creator_role: activeCreatorRole }
          : {}),
      };

      const metadataUpdate = await supabase.auth.admin.updateUserById(
        user.id,
        {
          email_confirm: true,
          user_metadata: nextMetadata,
        }
      );

      if (metadataUpdate.error || !metadataUpdate.data?.user) {
        throw metadataUpdate.error || new Error('Could not confirm your Artiste account.');
      }

      user = metadataUpdate.data.user;

    } else {
      user = await findExistingAuthUserByEmail(supabase, email);

      if (!user) {
        return NextResponse.json({
          error: 'No existing account was found for this email. Choose New User — Sign Up to join Artiste.',
        }, { status: 404 });
      }

      let portalProfile = await getPortalProfile(
        supabase,
        user.id,
        accountType,
        creatorRole
      );

      if (!portalProfile && accountType === 'customer') {
        portalProfile = await ensureLegacyCustomerProfile(supabase, user, email);
      }

      if (!portalProfile) {
        const label = accountType === 'customer'
          ? 'Customer'
          : creatorRole;

        return NextResponse.json({
          error: `No ${label} profile is registered for this email. Choose New User — Sign Up to add this portal.`,
        }, { status: 403 });
      }

      activeCreatorRole = accountType === 'artist'
        ? normalizeCreatorRole(portalProfile.creator_role || creatorRole)
        : null;

      // OTP login with no password verifies the email and signs into this
      // portal. When a password accompanies the OTP, only that portal's hash
      // is updated; other portal passwords remain unchanged.
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
        portal_accounts: portalAccountsFor(user, accountType),
        brand: 'Artiste',
        ...(accountType === 'artist'
          ? { creator_role: activeCreatorRole }
          : {}),
      };

      const updateResult = await supabase.auth.admin.updateUserById(
        user.id,
        {
          user_metadata: nextMetadata,
          ...(user.email_confirmed_at
            ? {}
            : { email_confirm: true }),
        }
      );

      if (updateResult.error || !updateResult.data?.user) {
        throw updateResult.error || new Error('Could not update your Artiste account.');
      }

      user = updateResult.data.user;
    }

    const established = await mintUserSession(supabase, email, user);

    const roleName = accountType === 'customer'
      ? 'Customer'
      : activeCreatorRole;

    return NextResponse.json({
      verified: true,
      accountType,
      creatorRole: accountType === 'artist' ? activeCreatorRole : undefined,
      reusedAuthUser,
      message:
        purpose === 'signup'
          ? `${roleName} profile created. Your portal has its own independent password.`
          : requestedPassword
            ? `Your ${roleName} portal password has been updated.`
            : `Your ${roleName} portal email is verified and you are signed in.`,
      session: established.session,
      user: established.user,
    });

  } catch (error) {
    console.error('Artiste verify OTP error:', error?.message || error);
    return NextResponse.json(
      { error: safeMessage(error) },
      { status: httpStatus(error, 500) }
    );
  }
}
