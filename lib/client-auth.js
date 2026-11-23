'use client';

const STORAGE_KEY = 'artiste.portal.session.v1';
const SESSION_EVENT = 'artiste:portal-session-change';

let memorySession = null;

function clearLegacySupabaseTokens() {
  if (typeof window === 'undefined') return;

  try {
    const keysToRemove = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith('sb-')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      window.localStorage.removeItem(key);
    });
  } catch {
    // Storage may be disabled by the browser; the HTTP-only cookie still works.
  }

  try {
    const sessionKeys = [];

    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith('sb-')) {
        sessionKeys.push(key);
      }
    }

    sessionKeys.forEach((key) => {
      window.sessionStorage.removeItem(key);
    });
  } catch {
    // Ignore sessionStorage restrictions.
  }
}

function decodePortalToken(token) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = window.atob(padded);

    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0)
    );

    const payload = JSON.parse(new TextDecoder().decode(bytes));

    if (
      !payload?.profileId ||
      !payload?.userId ||
      !payload?.email ||
      !['customer', 'artist'].includes(payload.accountType) ||
      !Number.isFinite(Number(payload.exp)) ||
      Number(payload.exp) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    if (
      payload.accountType === 'artist' &&
      !['Painter', 'Photographer'].includes(payload.creatorRole)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function notifySessionChange(session) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(SESSION_EVENT, { detail: session })
  );
}

function readStoredSession() {
  if (typeof window === 'undefined') return null;

  clearLegacySupabaseTokens();

  let stored = null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    // Try sessionStorage or the in-memory copy below.
  }

  if (!stored) {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      // Use the in-memory copy below.
    }
  }

  stored ||= memorySession;

  if (!stored) return null;

  const payload = decodePortalToken(stored?.access_token);

  if (!payload) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage restrictions.
    }

    memorySession = null;
    return null;
  }

  const user = stored.user && typeof stored.user === 'object'
    ? stored.user
    : {};

  return {
    access_token: stored.access_token,
    token_type: 'bearer',
    expires_in: Math.max(
      0,
      payload.exp - Math.floor(Date.now() / 1000)
    ),
    expires_at: payload.exp,
    user: {
      id: payload.userId,
      email: payload.email,
      user_metadata: {
        ...(user.user_metadata || {}),
        account_type: payload.accountType,
        brand: 'Artiste',
        ...(payload.accountType === 'artist'
          ? { creator_role: payload.creatorRole }
          : {}),
      },
    },
    profileId: payload.profileId,
    accountType: payload.accountType,
    creatorRole: payload.creatorRole,
  };
}

export function setPortalSession(session, user) {
  if (typeof window === 'undefined') return null;

  clearLegacySupabaseTokens();

  const accessToken = session?.access_token;
  const payload = decodePortalToken(accessToken);

  if (!payload) {
    throw new Error(
      'The server returned an invalid or expired Artiste session. Please sign in again.'
    );
  }

  const cleanUser = {
    id: String(user?.id || payload.userId),
    email: String(user?.email || payload.email).toLowerCase(),
    user_metadata: {
      ...(user?.user_metadata || {}),
      account_type: payload.accountType,
      brand: 'Artiste',
      ...(payload.accountType === 'artist'
        ? { creator_role: payload.creatorRole }
        : {}),
    },
  };

  if (
    cleanUser.id !== payload.userId ||
    cleanUser.email !== payload.email
  ) {
    throw new Error(
      'The returned Artiste session does not match the verified account.'
    );
  }

  const stored = {
    access_token: accessToken,
    user: cleanUser,
    expires_at: payload.exp,
  };

  memorySession = stored;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(stored)
    );
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(stored)
      );
    } catch {
      // Keep the current tab authenticated with the in-memory token.
      // The server's HTTP-only cookie remains available to same-origin requests.
    }
  }

  const normalized = readStoredSession();
  notifySessionChange(normalized);

  return normalized;
}

export function getPortalSession(expectedAccountType = null) {
  const session = readStoredSession();
  if (!session) return null;

  if (
    expectedAccountType &&
    session.accountType !== expectedAccountType
  ) {
    return null;
  }

  return session;
}

export function clearPortalSession() {
  if (typeof window === 'undefined') return;

  clearLegacySupabaseTokens();
  memorySession = null;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage restrictions; the server logout endpoint clears the cookie.
  }

  notifySessionChange(null);
}

export function subscribePortalSession(callback) {
  if (
    typeof window === 'undefined' ||
    typeof callback !== 'function'
  ) {
    return () => {};
  }

  const handleCustom = () => {
    callback(getPortalSession());
  };

  const handleStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      callback(getPortalSession());
    }
  };

  window.addEventListener(SESSION_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(SESSION_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

/**
 * Use for authenticated portal APIs. The application Bearer token and the
 * same-origin HTTP-only cookie are sent together. Auth endpoints use ordinary
 * fetch with credentials: 'include' so an old Bearer token is not reused.
 */
export async function portalFetch(input, options = {}) {
  clearLegacySupabaseTokens();

  const session = getPortalSession();
  const headers = new Headers(options.headers || {});

  headers.delete('Authorization');

  if (session?.access_token) {
    headers.set(
      'Authorization',
      `Bearer ${session.access_token}`
    );
  }

  return fetch(input, {
    ...options,
    headers,
    credentials: 'include',
    cache: options.cache || 'no-store',
  });
}

/**
 * Compatibility helper for any remaining legacy caller. Supabase JWT amr
 * claims are no longer accepted; only an Artiste v1 signed token is.
 */
export function hasEmailOtpSession(session) {
  return Boolean(
    session?.access_token &&
    decodePortalToken(session.access_token)
  );
}
