import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import {
  createPortalSession,
  attachPortalSessionCookie,
} from '@/lib/auth-server';
import { hashPortalPassword } from '@/lib/portal-password';
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
  return String(value || '').trim().toLowerCase() === 'photographer'
    ? 'Photographer'
    : 'Painter';
}

function disciplineNotRegisteredMessage(role) {
  return `You are not registered as a ${role} yet. Please click New User — Sign Up above to create a separate ${role} account with its own password.`;
}

function otpHash({ email, accountType, purpose, code }) {
  const key =
    process.env.OTP_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      'OTP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY is not configured on the server.'
    );
  }

  return crypto
    .createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}

function roleTable(accountType) {
  return accountType === 'customer' ? 'profiles' : 'artists';
}

async function savePortalPassword(
  supabase,
  profile,
  accountType,
  password
) {
  if (!password) return;

  if (!profile?.id) {
    const error = new Error(
      'The selected portal profile could not be identified to save its password.'
    );

    error.status = 503;
    throw error;
  }

  const { data, error } = await supabase
    .from(roleTable(accountType))
    .update({
      password_hash: hashPortalPassword(password),
    })
    .eq('id', profile.id)
    .select('id')
    .maybeSingle();

  if (error || !data?.id) {
    console.error(
      'Artiste role-row password save failed:',
      error?.message || 'Profile row was not updated.'
    );

    const issue = new Error(
      'Your independent portal password could not be saved. Run the password_hash database migration for public.profiles and public.artists, then try again.'
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

  // One Supabase Auth identity can be shared across the Customer, Painter
  // and Photographer portals. Membership is checked separately in role rows.
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
      .select('id,user_id,email,creator_role,artist_name,phone,password_hash')
      .eq('email', email)
      .ilike('creator_role', role)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,phone,password_hash')
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
    .select('id,email,full_name,phone')
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

  if (
    ['42703', 'PGRST204'].includes(String(error?.code || '')) ||
    /password_hash.*(does not exist|schema cache)|column .*password_hash/i.test(value)
  ) {
    return 'The password_hash database migration is missing. Add password_hash to public.profiles and public.artists, then try again.';
  }

  if (Number(error?.status) >= 500) {
    return value.includes('password_hash')
      ? value
      : 'Something went wrong while verifying your code. Please try again.';
  }

  return value;
}

async function linkLegacyArtistProfile(
  supabase,
  profile,
  user,
  email
) {
  if (
    !profile ||
    !user?.id ||
    String(profile.user_id || '') === String(user.id)
  ) {
    return profile;
  }

  const { data, error } = await supabase
    .from('artists')
    .update({ user_id: user.id })
    .eq('id', profile.id)
    .eq('email', email)
    .select('id,user_id,email,creator_role,artist_name,phone,password_hash')
    .maybeSingle();

  if (error) throw error;

  return data || profile;
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
      (
        requestedPassword.length < MIN_PASSWORD ||
        requestedPassword.length > MAX_PASSWORD
      )
    ) {
      return NextResponse.json(
        {
          error: `Your password must contain ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
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

    // Consume the one-time Artiste OTP. This is not a Supabase Auth OTP
    // and is never passed to supabase.auth.verifyOtp().
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
    let portalProfile = null;
    let reusedAuthUser = false;

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

      portalProfile = await getPortalProfile(
        supabase,
        email,
        accountType,
        activeCreatorRole
      );

      if (!portalProfile) {
        throw new Error(
          'Your portal profile could not be created. Please try again.'
        );
      }

      // Each Customer / Painter / Photographer row owns its own scrypt hash.
      await savePortalPassword(
        supabase,
        portalProfile,
        accountType,
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
      // Existing-user OTP login and Forgot Password use the same verified
      // code flow. No password is required for OTP login itself.
      user = await findExistingAuthUserByEmail(
        supabase,
        email
      );

      if (!user) {
        return NextResponse.json(
          {
            error: accountType === 'artist'
              ? disciplineNotRegisteredMessage(activeCreatorRole)
              : 'You are not registered as a Customer yet. Please click New User — Sign Up above to create a separate Customer account with its own password.',
          },
          { status: 404 }
        );
      }

      portalProfile = await getPortalProfile(
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
        return NextResponse.json(
          {
            error: accountType === 'artist'
              ? disciplineNotRegisteredMessage(activeCreatorRole)
              : 'You are not registered as a Customer yet. Please click New User — Sign Up above to create a separate Customer account with its own password.',
          },
          { status: 404 }
        );
      }

      if (accountType === 'artist') {
        portalProfile = await linkLegacyArtistProfile(
          supabase,
          portalProfile,
          user,
          email
        );

        activeCreatorRole = normalizeCreatorRole(
          portalProfile.creator_role
        );
      }

      // This branch is only used by Forgot Password. A regular OTP login
      // passes no password and signs in directly after OTP consumption.
      if (requestedPassword) {
        await savePortalPassword(
          supabase,
          portalProfile,
          accountType,
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

    // The application session is a server-signed v1 token, not a Supabase JWT.
    // Its profileId binds it to exactly one selected role row.
    const established = createPortalSession({
      profile: portalProfile,
      user,
      email,
      accountType,
      creatorRole: activeCreatorRole,
    });

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

      session: established.session,
      user: established.user,
    });

    attachPortalSessionCookie(
      response,
      established.token
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
