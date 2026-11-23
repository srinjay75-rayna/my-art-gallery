import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';

const SESSION_COOKIE = 'artiste_portal_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ACCOUNT_TYPES = new Set(['customer', 'artist']);
const CREATOR_ROLES = new Set(['Painter', 'Photographer']);

function normalizeCreatorRole(value) {
  return String(value || '').trim().toLowerCase() === 'photographer'
    ? 'Photographer'
    : 'Painter';
}

function sessionSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }
  return secret;
}

function signToken(unsignedToken) {
  return crypto
    .createHmac('sha256', sessionSigningSecret())
    .update(unsignedToken)
    .digest('base64url');
}

function decodeAndVerifyPortalToken(token) {
  if (typeof token !== 'string' || token.length > 8192) return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const [, encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) return null;

  try {
    const expected = Buffer.from(
      signToken(`v1.${encodedPayload}`),
      'base64url'
    );
    const provided = Buffer.from(providedSignature, 'base64url');

    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );

    const now = Math.floor(Date.now() / 1000);
    const accountType = String(payload.accountType || '');

    if (
      !payload.profileId ||
      !payload.userId ||
      !payload.email ||
      !ACCOUNT_TYPES.has(accountType) ||
      !Number.isFinite(Number(payload.exp)) ||
      Number(payload.exp) <= now
    ) {
      return null;
    }

    if (
      accountType === 'artist' &&
      !CREATOR_ROLES.has(payload.creatorRole)
    ) {
      return null;
    }

    if (accountType === 'customer' && payload.creatorRole != null) {
      return null;
    }

    return {
      profileId: String(payload.profileId),
      userId: String(payload.userId),
      email: String(payload.email).trim().toLowerCase(),
      accountType,
      creatorRole: accountType === 'artist' ? payload.creatorRole : null,
      iat: Number(payload.iat) || 0,
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

/**
 * Create the same signed v1 token for both the Authorization header
 * and the HTTP-only cookie. userId remains the Supabase Auth UUID used
 * by existing APIs; profileId identifies the selected portal row.
 */
export function createPortalSession({
  profile,
  user,
  email,
  accountType,
  creatorRole,
}) {
  if (!profile?.id || !user?.id) {
    throw new Error('The selected Artiste portal profile could not be identified.');
  }

  if (!ACCOUNT_TYPES.has(accountType)) {
    throw new Error('Choose a valid Artiste portal.');
  }

  const normalizedEmail = String(email || profile.email || user.email || '')
    .trim()
    .toLowerCase();

  if (!normalizedEmail) {
    throw new Error('The verified email address is missing.');
  }

  const normalizedRole = accountType === 'artist'
    ? normalizeCreatorRole(creatorRole || profile.creator_role)
    : null;

  if (
    accountType === 'artist' &&
    !CREATOR_ROLES.has(normalizedRole)
  ) {
    throw new Error('Choose Painter or Photographer before signing in.');
  }

  const expectedUserId = accountType === 'artist'
    ? String(profile.user_id || '')
    : String(profile.id);

  if (!expectedUserId || expectedUserId !== String(user.id)) {
    throw new Error('The selected portal profile does not match this account.');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_SECONDS;
  const payload = {
    profileId: String(profile.id),
    userId: String(user.id),
    email: normalizedEmail,
    accountType,
    creatorRole: normalizedRole,
    iat: now,
    exp,
  };

  const encodedPayload = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url');

  const unsignedToken = `v1.${encodedPayload}`;
  const token = `${unsignedToken}.${signToken(unsignedToken)}`;

  const userMetadata = {
    ...(user.user_metadata || {}),
    account_type: accountType,
    brand: 'Artiste',
    ...(accountType === 'artist'
      ? { creator_role: normalizedRole }
      : {}),
    ...(profile.full_name || profile.artist_name
      ? { full_name: profile.full_name || profile.artist_name }
      : {}),
    ...(profile.phone ? { phone: profile.phone } : {}),
  };

  return {
    token,
    payload,
    session: {
      access_token: token,
      token_type: 'bearer',
      expires_in: SESSION_SECONDS,
      expires_at: exp,
    },
    user: {
      id: String(user.id),
      email: normalizedEmail,
      user_metadata: userMetadata,
      // This token is only minted after OTP verification or a
      // confirmed account's password has been checked.
      email_confirmed_at: user.email_confirmed_at || new Date().toISOString(),
    },
  };
}

export function attachPortalSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });

  return response;
}

export function clearPortalSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}

function getCookieValue(request, name) {
  try {
    const value = request.cookies?.get(name)?.value;
    if (value) return value;
  } catch {
    // Fall through to the Cookie header for non-NextRequest callers.
  }

  const cookieHeader = request.headers.get('cookie') || '';

  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;

    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }

  return null;
}

function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function inferRequiredAccountType(request) {
  try {
    const pathname = new URL(request.url).pathname;

    if (
      pathname === '/api/artist' ||
      pathname.startsWith('/api/artist/')
    ) {
      return 'artist';
    }

    if (
      pathname === '/api/account' ||
      pathname.startsWith('/api/account/')
    ) {
      return 'customer';
    }
  } catch {
    // The explicit accountType option remains authoritative when URL parsing fails.
  }

  return null;
}

async function loadPortalProfile(payload) {
  const supabase = requireServiceRole();

  if (payload.accountType === 'customer') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,phone')
      .eq('id', payload.profileId)
      .eq('id', payload.userId)
      .maybeSingle();

    if (error) throw error;

    if (
      !data ||
      String(data.email || '').trim().toLowerCase() !== payload.email
    ) {
      return null;
    }

    return data;
  }

  const { data, error } = await supabase
    .from('artists')
    .select('id,user_id,email,creator_role,artist_name,phone')
    .eq('id', payload.profileId)
    .eq('user_id', payload.userId)
    .ilike('creator_role', payload.creatorRole)
    .maybeSingle();

  if (error) throw error;

  if (
    !data ||
    String(data.email || '').trim().toLowerCase() !== payload.email
  ) {
    return null;
  }

  return data;
}

function authenticationError(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

/**
 * Both Bearer and cookie credentials use the exact same v1 HMAC verifier.
 * These are application tokens, not Supabase JWTs: never pass them to
 * supabase.auth.getUser().
 */
export async function getUserFromRequest(
  request,
  {
    optional = false,
    accountType = null,
  } = {}
) {
  const requiredAccountType = accountType || inferRequiredAccountType(request);
  const bearerToken = getBearerToken(request);
  const cookieToken = getCookieValue(request, SESSION_COOKIE);

  // A browser should send the exact same signed token through both channels.
  // Reject a split Customer/Artist identity instead of silently selecting one.
  if (bearerToken && cookieToken && bearerToken !== cookieToken) {
    const bearerPayload = decodeAndVerifyPortalToken(bearerToken);
    const cookiePayload = decodeAndVerifyPortalToken(cookieToken);

    if (
      bearerPayload &&
      cookiePayload &&
      (
        bearerPayload.profileId !== cookiePayload.profileId ||
        bearerPayload.userId !== cookiePayload.userId ||
        bearerPayload.accountType !== cookiePayload.accountType ||
        bearerPayload.creatorRole !== cookiePayload.creatorRole
      )
    ) {
      if (optional) return null;

      throw authenticationError(
        'Your Artiste sign-in credentials do not match. Please sign in again.'
      );
    }
  }

  const candidates = [bearerToken, cookieToken].filter(Boolean);
  const uniqueTokens = [...new Set(candidates)];

  if (!uniqueTokens.length) {
    if (optional) return null;
    throw authenticationError('Please sign in to continue.');
  }

  let lastError = null;

  for (const token of uniqueTokens) {
    const payload = decodeAndVerifyPortalToken(token);
    if (!payload) continue;

    if (requiredAccountType && payload.accountType !== requiredAccountType) {
      lastError = authenticationError(
        `This page is for ${requiredAccountType === 'artist' ? 'Artists' : 'Customers'} only. Please use the correct Artiste portal.`
      );
      continue;
    }

    try {
      const profile = await loadPortalProfile(payload);
      if (!profile) continue;

      const userMetadata = {
        account_type: payload.accountType,
        brand: 'Artiste',
        ...(payload.accountType === 'artist'
          ? { creator_role: payload.creatorRole }
          : {}),
        ...(profile.full_name || profile.artist_name
          ? { full_name: profile.full_name || profile.artist_name }
          : {}),
        ...(profile.phone ? { phone: profile.phone } : {}),
      };

      return {
        id: payload.userId,
        profileId: payload.profileId,
        email: payload.email,
        user_metadata: userMetadata,
        email_confirmed_at: new Date(
          payload.iat * 1000 || Date.now()
        ).toISOString(),
        portal: {
          profileId: payload.profileId,
          accountType: payload.accountType,
          creatorRole: payload.creatorRole,
          expiresAt: payload.exp,
        },
      };
    } catch (error) {
      lastError = error;
      console.error(
        'Artiste portal profile validation failed:',
        error?.message || error
      );
    }
  }

  if (optional) return null;

  if (lastError?.status === 401) throw lastError;

  throw authenticationError(
    'Your sign-in session is invalid or has expired. Please sign in again.'
  );
}

/**
 * Keep returning the artist row without its credential hash. This helper is
 * used by existing Artist API routes that expect the Supabase user UUID.
 */
export async function getArtistForUser(
  supabase,
  userId,
  creatorRole = null
) {
  let query = supabase
    .from('artists')
    .select('*')
    .eq('user_id', userId);

  if (creatorRole) {
    query = query.ilike(
      'creator_role',
      normalizeCreatorRole(creatorRole)
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(creatorRole ? 1 : 2);

  if (error) throw error;
  if (!data?.length) return null;

  const { password_hash: _passwordHash, ...safeArtist } = data[0];
  return safeArtist;
}
