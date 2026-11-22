import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRole } from '@/lib/supabase';
import { enforceRateLimit, rateLimitJsonResponse, readJsonBody } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedAccountTypes = new Set(['customer', 'artist']);
// Password reset reuses the "login" purpose (the deployed email_otps CHECK
// constraint only allows login | signup); a password in the request body
// is what turns a verified login code into a reset.
const allowedPurposes = new Set(['login', 'signup']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt limit enforced by Supabase Auth

function otpHash({ email, accountType, purpose, code }) {
  const key = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set OTP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY on the server.');
  return crypto.createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}

function httpStatus(error, fallback = 400) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
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
  // One Supabase Auth identity per email can own BOTH a Customer profile
  // (public.profiles) and an Artist profile (public.artists). Look through
  // Artiste's own tables first, then fall back to scanning the Auth directory.
  const profileLookups = await Promise.all([
    supabase.from('profiles').select('id').eq('email', email).limit(2),
    supabase.from('artists').select('user_id').eq('email', email).limit(2),
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

  throw new Error('Could not complete the account lookup. Please try again or contact Artiste support.');
}

async function getPortalProfile(supabase, userId, accountType) {
  if (accountType === 'artist') {
    const { data, error } = await supabase
      .from('artists')
      .select('id,creator_role')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // Customer identity and delivery details live in public.profiles
  // (id = auth.users.id), matching /api/account.
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureLegacyCustomerProfile(supabase, user, email) {
  // Legacy V10 Customer sign-ups created the Auth identity first and wrote
  // public.profiles only during onboarding. A verified legacy Customer gets a
  // minimal profile row so they can continue to onboarding.
  if (user.user_metadata?.account_type !== 'customer' || user.user_metadata?.brand !== 'Artiste') {
    return null;
  }

  const { data, error } = await supabase.from('profiles').upsert({
    id: user.id,
    email: String(email || user.email || '').toLowerCase(),
    full_name: String(user.user_metadata?.full_name || '').slice(0, 100),
    phone: String(user.user_metadata?.phone || '').slice(0, 20),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select('id').single();

  if (error) throw error;
  return data || null;
}

async function createCustomerProfile(supabase, user, payload, email) {
  const fullName = String(payload.full_name || payload.artist_name || 'Customer').trim().slice(0, 100);
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
  const artistName = String(payload.artist_name || payload.full_name || 'Artist').trim().slice(0, 100) || 'Artist';

  const { error } = await supabase.from('artists').upsert({
    user_id: user.id,
    email,
    artist_name: artistName,
    creator_role: creatorRole,
    bio: '',
    city: '',
    state: '',
    pickup_address: '',
    pickup_contact_name: artistName,
    pickup_phone: String(payload.phone || ''),
    pickup_landmark: '',
    pickup_locality: '',
    pickup_pincode: '',
    pickup_location: 'Primary',
    is_approved: false,
    is_suspended: false,
  }, { onConflict: 'user_id' });

  if (error) throw error;
}

function portalAccountsFor(user, accountType) {
  return [...new Set([
    ...(Array.isArray(user?.user_metadata?.portal_accounts)
      ? user.user_metadata.portal_accounts.filter((type) => allowedAccountTypes.has(type))
      : []),
    accountType,
  ])];
}

function duplicatePortalError(accountType) {
  return statusError(
    `${accountType === 'artist' ? 'An Artist' : 'A Customer'} account already exists for this email. Choose Existing User — Log In instead.`,
    409
  );
}

function safeMessage(error) {
  const value = String(error?.message || 'Authentication could not be completed.');
  if (/already registered|already been registered|user already exists|email_exists/i.test(value)) {
    return 'An Artiste login already exists for this email. You can add the other portal through New User — Sign Up, or choose Existing User — Log In.';
  }
  // Never echo raw database / provider errors for server-side failures.
  if (!Number.isInteger(Number(error?.status)) || Number(error.status) >= 500) {
    return /password/i.test(value) ? value : 'Something went wrong while verifying your code. Please try again.';
  }
  return value;
}

// verifyOtp() stores the resulting session on whichever client calls it. A
// dedicated, single-use client keeps that user session away from the
// service-role client, which must keep acting with service privileges.
function createSessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL and key are not configured on the server.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
        'Too many verification attempts from this connection. Please wait before trying again.'
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const email = String(body.email || '').trim().toLowerCase();
    const accountType = String(body.accountType || '').trim().toLowerCase();
    const purpose = String(body.purpose || '').trim().toLowerCase();
    const code = String(body.otp || '').trim();
    const requestedPassword = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (!allowedAccountTypes.has(accountType) || !allowedPurposes.has(purpose)) {
      return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 });
    }
    if ((purpose === 'signup' || requestedPassword) && requestedPassword.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `Your password must contain at least ${MIN_PASSWORD} characters.` }, { status: 400 });
    }
    if (requestedPassword.length > MAX_PASSWORD) {
      return NextResponse.json({ error: `Your password must not be longer than ${MAX_PASSWORD} characters.` }, { status: 400 });
    }

    const supabase = requireServiceRole();
    const { data: consumed, error: consumeError } = await supabase.rpc('consume_email_otp', {
      p_email: email,
      p_account_type: accountType,
      p_purpose: purpose,
      p_otp_hash: otpHash({ email, accountType, purpose, code }),
    });

    if (consumeError) {
      console.error('Artiste consume OTP error:', consumeError.message);
      return NextResponse.json({
        error: 'The OTP verification database function is unavailable. Run the updated database/schema.sql in Supabase.',
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

    if (purpose === 'signup') {
      const payload = result.payload && typeof result.payload === 'object' ? result.payload : {};

      if (payload.account_type !== accountType) {
        return NextResponse.json({ error: 'The verification request does not match this portal.' }, { status: 400 });
      }

      const creatorRole = payload.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      const accountMetadata = accountType === 'artist'
        ? { ...payload, account_type: 'artist', creator_role: creatorRole, brand: 'Artiste' }
        : { ...payload, account_type: 'customer', brand: 'Artiste' };

      // Create the Auth identity first (the common, fast path). If the email
      // already has one — for example a Customer now adding an Artist profile —
      // reuse it instead of failing with "User already registered".
      const createResult = await supabase.auth.admin.createUser({
        email,
        password: requestedPassword,
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

        if (await getPortalProfile(supabase, user.id, accountType)) {
          throw duplicatePortalError(accountType);
        }
      }

      // Explicitly commit the password and confirm the email once the OTP has
      // been verified, so Email + Password sign-in works immediately — for
      // brand-new identities and for a second portal added to an existing one.
      const passwordUpdate = await supabase.auth.admin.updateUserById(user.id, {
        password: requestedPassword,
        email_confirm: true,
        user_metadata: {
          ...(user.user_metadata || {}),
          ...accountMetadata,
          account_type: accountType,
          portal_accounts: portalAccountsFor(user, accountType),
          ...(accountType === 'artist' ? { creator_role: creatorRole } : {}),
        },
      });
      if (passwordUpdate.error || !passwordUpdate.data?.user) {
        throw passwordUpdate.error || new Error('Could not set the password for your Artiste account.');
      }
      user = passwordUpdate.data.user;

      // Store the portal profile now so membership exists before the first
      // dashboard visit. Customer and Artist records stay independent.
      if (accountType === 'customer') {
        await createCustomerProfile(supabase, user, payload, email);
      } else {
        await createArtistDraft(supabase, user, payload, email, creatorRole);
      }
    } else {
      user = await findExistingAuthUserByEmail(supabase, email);
      if (!user) {
        return NextResponse.json({
          error: 'No existing account was found for this email. Choose New User — Sign Up to join Artiste.',
        }, { status: 404 });
      }

      // Portal membership — not the single Auth email — decides which Artiste
      // portal this verified email may enter.
      let portalProfile = await getPortalProfile(supabase, user.id, accountType);
      if (!portalProfile && accountType === 'customer') {
        portalProfile = await ensureLegacyCustomerProfile(supabase, user, email);
      }
      if (!portalProfile) {
        return NextResponse.json({
          error: `No ${accountType === 'artist' ? 'Artist' : 'Customer'} profile is registered for this email. Choose New User — Sign Up to add this portal.`,
        }, { status: 403 });
      }

      const creatorRole = portalProfile.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      const nextMetadata = {
        ...(user.user_metadata || {}),
        account_type: accountType,
        portal_accounts: portalAccountsFor(user, accountType),
        brand: 'Artiste',
        ...(accountType === 'artist' ? { creator_role: creatorRole } : {}),
      };

      // Whenever a password accompanies a verified code (password reset, or a
      // legacy account whose password never saved), write it to Supabase Auth
      // together with email_confirm so Email + Password login works.
      const updateResult = await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: nextMetadata,
        ...(requestedPassword
          ? { password: requestedPassword, email_confirm: true }
          : user.email_confirmed_at ? {} : { email_confirm: true }),
      });
      if (updateResult.error || !updateResult.data?.user) {
        throw updateResult.error || new Error('Could not update your Artiste account.');
      }
      user = updateResult.data.user;
    }

    // Mint a one-time, server-side session token after the password and portal
    // metadata have been saved.
    const sessionLink = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    if (sessionLink.error || !sessionLink.data?.user) {
      throw sessionLink.error || new Error('Could not issue a sign-in session for this account.');
    }
    const tokenHash = sessionLink.data?.properties?.hashed_token || sessionLink.data?.hashed_token;
    if (!tokenHash) {
      throw new Error('Supabase did not issue a sign-in session. Check your Auth configuration.');
    }

    const { data: verified, error: verifyError } = await createSessionClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });
    if (verifyError || !verified?.session) {
      throw verifyError || new Error('Could not establish your Artiste session.');
    }

    return NextResponse.json({
      verified: true,
      accountType,
      reusedAuthUser,
      sharedPasswordAcrossPortals: reusedAuthUser,
      message: purpose === 'login' && requestedPassword
        ? 'Your password has been updated. You are signed in to the selected Artiste portal.'
        : purpose === 'login'
          ? 'Your email is verified. You are signed in to the selected Artiste portal.'
          : reusedAuthUser
            ? 'Your second Artiste portal has been added to the same verified email login. The password you just set is shared by both portals.'
            : 'Your Artiste account is ready.',
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
        email_confirmed_at: verified.user?.email_confirmed_at || user.email_confirmed_at || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Artiste verify OTP error:', error?.message || error);
    return NextResponse.json({ error: safeMessage(error) }, { status: httpStatus(error, 500) });
  }
}
