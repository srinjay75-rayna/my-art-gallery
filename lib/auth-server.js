import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';

const SESSION_COOKIE = 'artiste_portal_session';

const SUPPORTED_AUTH_METHODS = new Set([
  'otp',
  'email/signup',
  'magiclink',
  'email',
  'password',
]);

/* ==========================================
   SESSION COOKIE SECRET
========================================== */

function getSessionSecret() {
  const secret =
    process.env.AUTH_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error(
      'AUTH_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY is not configured.'
    );
  }

  return secret;
}

/* ==========================================
   COOKIE EXTRACTION
========================================== */

function getCookieValue(request, name) {
  // NextRequest cookie API.
  try {
    const value = request.cookies?.get(name)?.value;

    if (value) return value;
  } catch {
    // Fall back to the raw Cookie header.
  }

  const cookieHeader = request.headers.get('cookie') || '';

  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');

    if (separator < 0) continue;

    const cookieName = item.slice(0, separator).trim();

    if (cookieName !== name) continue;

    return item.slice(separator + 1).trim();
  }

  return null;
}

/* ==========================================
   BEARER TOKEN EXTRACTION
========================================== */

function getBearerToken(request) {
  const authorization =
    request.headers.get('authorization') || '';

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

/* ==========================================
   SIGNED HTTP-ONLY COOKIE VERIFICATION
========================================== */

function verifySignedPortalCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return null;
  }

  const parts = cookieValue.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, providedSignature] = parts;

  if (!encodedPayload || !providedSignature) {
    return null;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', getSessionSecret())
      .update(encodedPayload)
      .digest('base64url');

    const expectedBuffer = Buffer.from(
      expectedSignature,
      'base64url'
    );

    const providedBuffer = Buffer.from(
      providedSignature,
      'base64url'
    );

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(
        expectedBuffer,
        providedBuffer
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        'base64url'
      ).toString('utf8')
    );

    const now = Math.floor(Date.now() / 1000);

    // Validate the signed session envelope.

    if (
      payload.version !== 1 ||
      !payload.sub ||
      !payload.email ||
      !payload.account_type ||
      !payload.session ||
      !payload.session.access_token ||
      !payload.session.refresh_token ||
      !Number.isFinite(Number(payload.exp)) ||
      Number(payload.exp) <= now
    ) {
      return null;
    }

    if (
      payload.account_type !== 'customer' &&
      payload.account_type !== 'artist'
    ) {
      return null;
    }

    if (
      payload.account_type === 'artist' &&
      !['Painter', 'Photographer'].includes(
        payload.creator_role
      )
    ) {
      return null;
    }

    return payload;

  } catch (error) {
    console.warn(
      'Artiste signed session cookie verification failed:',
      error?.message || error
    );

    return null;
  }
}

/* ==========================================
   SUPABASE ACCESS TOKEN VALIDATION
========================================== */

async function validateSupabaseToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const supabase = requireServiceRole();

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return null;
    }

    return data.user;

  } catch (error) {
    console.warn(
      'Artiste Supabase session validation failed:',
      error?.message || error
    );

    return null;
  }
}

/* ==========================================
   BEARER JWT AUTH-METHOD VALIDATION
========================================== */

function hasSupportedAuthMethod(token) {
  try {
    const parts = token.split('.');

    if (parts.length !== 3) return false;

    const payload = JSON.parse(
      Buffer.from(
        parts[1],
        'base64url'
      ).toString('utf8')
    );

    const methods = Array.isArray(payload.amr)
      ? payload.amr
          .filter(
            (entry) =>
              entry?.method &&
              entry.method !== 'token_refresh'
          )
          .sort(
            (a, b) =>
              Number(b.timestamp || 0) -
              Number(a.timestamp || 0)
          )
          .map((entry) => entry.method)
      : [];

    return SUPPORTED_AUTH_METHODS.has(methods[0]);

  } catch {
    return false;
  }
}

/* ==========================================
   OPTIONAL / REQUIRED AUTH ERRORS
========================================== */

function authenticationError(message) {
  return new Error(message);
}

/* ==========================================
   MAIN AUTHENTICATION FUNCTION

   Supports:
   1. Authorization: Bearer <access_token>
   2. artiste_portal_session HTTP-only cookie

   Bearer takes priority when available.
   If it fails, a valid signed cookie is tried.
========================================== */

export async function getUserFromRequest(
  request,
  {
    optional = false,
    accountType = null,
  } = {}
) {
  const bearerToken = getBearerToken(request);

  const cookieValue = getCookieValue(
    request,
    SESSION_COOKIE
  );

  const cookiePayload = verifySignedPortalCookie(
    cookieValue
  );

  const cookieToken =
    cookiePayload?.session?.access_token || null;

  // Try the Bearer token first, then the signed cookie.
  // This supports existing EmailOtpAuth.js clients while
  // also supporting cookie-authenticated API requests.

  const candidates = [];

  if (bearerToken) {
    candidates.push({
      token: bearerToken,
      source: 'bearer',
      signedPayload: null,
    });
  }

  if (
    cookieToken &&
    cookieToken !== bearerToken
  ) {
    candidates.push({
      token: cookieToken,
      source: 'cookie',
      signedPayload: cookiePayload,
    });
  }

  if (!candidates.length) {
    if (optional) return null;

    throw authenticationError(
      'Please sign in to continue.'
    );
  }

  const supabase = requireServiceRole();

  let authenticatedUser = null;
  let authenticationSource = null;
  let signedPayload = null;

  for (const candidate of candidates) {
    try {
      const { data, error } =
        await supabase.auth.getUser(candidate.token);

      if (error || !data?.user) {
        continue;
      }

      const user = data.user;

      // A signed server-issued cookie is itself proof that
      // the Artiste server established this portal session.
      //
      // Bearer-only requests must also have a supported
      // Supabase Auth Methods Reference.

      if (
        candidate.source === 'bearer' &&
        !hasSupportedAuthMethod(candidate.token)
      ) {
        continue;
      }

      // Ensure cookie identity matches the verified JWT identity.

      if (candidate.signedPayload) {
        const payload = candidate.signedPayload;

        if (
          payload.sub !== user.id ||
          String(payload.email).toLowerCase() !==
            String(user.email || '').toLowerCase()
        ) {
          continue;
        }
      }

      authenticatedUser = user;
      authenticationSource = candidate.source;
      signedPayload = candidate.signedPayload;

      break;

    } catch (error) {
      console.warn(
        `Artiste ${candidate.source} authentication failed:`,
        error?.message || error
      );
    }
  }

  if (!authenticatedUser) {
    if (optional) return null;

    throw authenticationError(
      'Your sign-in session is invalid or has expired. Please sign in again.'
    );
  }

  /* ==========================================
     EMAIL VERIFICATION
  ========================================== */

  if (!authenticatedUser.email_confirmed_at) {
    if (optional) return null;

    throw authenticationError(
      'Please verify your email address before continuing.'
    );
  }

  /* ==========================================
     PORTAL SEPARATION
  ========================================== */

  const metadataAccountType =
    authenticatedUser.user_metadata?.account_type;

  const sessionAccountType =
    signedPayload?.account_type || metadataAccountType;

  if (
    sessionAccountType &&
    !['customer', 'artist'].includes(sessionAccountType)
  ) {
    if (optional) return null;

    throw authenticationError(
      'Your Artiste account type is invalid. Please sign in again.'
    );
  }

  if (
    accountType &&
    sessionAccountType !== accountType
  ) {
    if (optional) return null;

    throw authenticationError(
      `This page is for ${
        accountType === 'artist'
          ? 'Artists'
          : 'Customers'
      } only. Please use the correct Artiste portal.`
    );
  }

  /* ==========================================
     CREATOR DISCIPLINE CONSISTENCY
  ========================================== */

  if (sessionAccountType === 'artist') {
    const cookieRole = signedPayload?.creator_role;

    const metadataRole =
      authenticatedUser.user_metadata?.creator_role;

    if (
      cookieRole &&
      metadataRole &&
      cookieRole !== metadataRole
    ) {
      if (optional) return null;

      throw authenticationError(
        'Your selected Creator discipline does not match your session. Please sign in again.'
      );
    }
  }

  // Return the original Supabase-verified Auth user.
  // Existing API routes remain compatible.

  return authenticatedUser;
}

/* ==========================================
   ARTIST PROFILE LOOKUP
========================================== */

export async function getArtistForUser(
  supabase,
  userId,
  creatorRole = null
) {
  let query = supabase
    .from('artists')
    .select('*')
    .eq('user_id', userId);

  // A user can have separate Painter and Photographer profiles.
  // When discipline is supplied, retrieve that exact profile.

  if (creatorRole) {
    query = query.ilike(
      'creator_role',
      creatorRole
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(creatorRole ? 1 : 2);

  if (error) throw error;

  if (!data?.length) return null;

  // Preserve compatibility with existing callers that
  // expect one Artist profile when no role is specified.

  return data[0];
}
