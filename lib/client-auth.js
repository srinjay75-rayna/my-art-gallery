'use client';

const STORAGE_KEY = 'artiste.portal.session.v1';
const SESSION_EVENT = 'artiste:portal-session-change';
const LAST_ACTIVITY_KEY = `${STORAGE_KEY}.last_activity`;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
];

let memorySession = null;
let inactivityTimer = null;
let lastActivityAt = 0;
let lastPersistedActivityAt = 0;
let activityListenersAttached = false;

function readSharedActivityTimestamp() {
  if (typeof window === 'undefined') return 0;

  try {
    const timestamp = Number(
      window.localStorage.getItem(LAST_ACTIVITY_KEY)
    );
    return Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : 0;
  } catch {
    return 0;
  }
}

function stopInactivityMonitor(removeTimestamp = false) {
  if (typeof window === 'undefined') return;

  if (inactivityTimer) {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  if (activityListenersAttached) {
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, handleUserActivity);
    });
    window.removeEventListener('storage', handleActivityStorage);
    activityListenersAttached = false;
  }

  lastActivityAt = 0;
  lastPersistedActivityAt = 0;

  if (removeTimestamp) {
    try {
      window.localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  }
}

function scheduleInactivityTimeout() {
  if (typeof window === 'undefined' || !activityListenersAttached) return;

  if (inactivityTimer) {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  if (!lastActivityAt) return;

  const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt);
  if (remaining <= 0) {
    expireInactiveSession();
    return;
  }

  inactivityTimer = window.setTimeout(
    expireInactiveSession,
    remaining
  );
}

function persistActivityTimestamp(timestamp) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
    lastPersistedActivityAt = timestamp;
  } catch {
    // The in-memory inactivity timer still protects this tab.
  }
}

function handleUserActivity() {
  if (typeof window === 'undefined' || !activityListenersAttached) return;

  const now = Date.now();
  const sharedTimestamp = readSharedActivityTimestamp();
  if (sharedTimestamp > lastActivityAt) {
    lastActivityAt = sharedTimestamp;
  }

  // An interaction after the full idle window does not revive an expired session.
  if (lastActivityAt && now - lastActivityAt >= INACTIVITY_TIMEOUT_MS) {
    expireInactiveSession();
    return;
  }

  lastActivityAt = now;
  scheduleInactivityTimeout();

  // Keep other open tabs in sync without writing on every mousemove event.
  if (now - lastPersistedActivityAt >= 1000) {
    persistActivityTimestamp(now);
  }
}

function handleActivityStorage(event) {
  if (event.key !== LAST_ACTIVITY_KEY || !event.newValue) return;

  const timestamp = Number(event.newValue);
  if (!Number.isFinite(timestamp) || timestamp <= lastActivityAt) return;

  lastActivityAt = timestamp;
  lastPersistedActivityAt = timestamp;
  scheduleInactivityTimeout();
}

function startInactivityMonitor(resetActivity = false) {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  if (activityListenersAttached) {
    if (resetActivity) {
      lastActivityAt = now;
      persistActivityTimestamp(now);
      scheduleInactivityTimeout();
    }
    return true;
  }

  const sharedTimestamp = resetActivity ? 0 : readSharedActivityTimestamp();
  const hasSharedTimestamp =
    sharedTimestamp > 0 && sharedTimestamp <= now;
  const sharedTimestampIsExpired =
    hasSharedTimestamp &&
    now - sharedTimestamp >= INACTIVITY_TIMEOUT_MS;
  const sharedTimestampIsRecent =
    hasSharedTimestamp && !sharedTimestampIsExpired;

  lastActivityAt = sharedTimestampIsRecent
    ? sharedTimestamp
    : sharedTimestampIsExpired
      ? sharedTimestamp
      : now;
  lastPersistedActivityAt = hasSharedTimestamp ? sharedTimestamp : 0;
  activityListenersAttached = true;

  ACTIVITY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, handleUserActivity, { passive: true });
  });
  window.addEventListener('storage', handleActivityStorage);

  if (!hasSharedTimestamp || resetActivity) {
    persistActivityTimestamp(now);
  }

  if (sharedTimestampIsExpired) {
    // A reload or a newly opened tab must not restart an already elapsed idle window.
    expireInactiveSession();
    return false;
  }

  scheduleInactivityTimeout();
  return true;
}

function expireInactiveSession() {
  if (typeof window === 'undefined' || !activityListenersAttached) return;

  const sharedTimestamp = readSharedActivityTimestamp();
  if (sharedTimestamp > lastActivityAt) {
    lastActivityAt = sharedTimestamp;
  }

  const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt);
  if (remaining > 0) {
    scheduleInactivityTimeout();
    return;
  }

  // Clear the browser session immediately and also clear the HTTP-only cookie.
  stopInactivityMonitor(true);
  clearPortalSession();

  try {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Local credentials have already been cleared.
  }
}

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

  if (!stored) {
    stopInactivityMonitor(true);
    return null;
  }

  const payload = decodePortalToken(stored?.access_token);

  if (!payload) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage restrictions.
    }

    memorySession = null;
    stopInactivityMonitor(true);
    return null;
  }

  if (!startInactivityMonitor(false)) return null;

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
  startInactivityMonitor(true);

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
  stopInactivityMonitor(true);

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
      if (!event.newValue) memorySession = null;
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
