import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import {
  createPortalSession,
  attachPortalSessionCookie,
} from '@/lib/auth-server';
import {
  encryptPortalPasswordHash,
  isEncryptedPortalPasswordHash,
  verifyPortalPassword,
} from '@/lib/portal-password';
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

function normalizeCreatorRole(value) {
  return String(value || '').trim().toLowerCase() === 'photographer'
    ? 'Photographer'
    : 'Painter';
}

function disciplineNotRegisteredMessage(role) {
  return `You are not registered as a ${role} yet. Please click New User — Sign Up above to create a separate ${role} account with its own password.`;
}

async function getPortalProfile(supabase, email, accountType, creatorRole) {
  if (accountType === 'customer') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,phone,password_hash')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

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

async function findAuthUserForProfile(supabase, email, profile, accountType) {
  const userId = accountType === 'customer'
    ? profile?.id
    : profile?.user_id;

  if (userId) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);

    if (
      !error &&
      data?.user &&
      String(data.user.email || '').toLowerCase() === email
    ) {
      return data.user;
    }
  }

  // Legacy artist rows may have an empty or outdated user_id. Resolve the
  // existing verified Auth identity by email without changing its password.
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const users = data?.users || [];

    const found = users.find(
      (candidate) => String(candidate.email || '').toLowerCase() === email
    );

    if (found) return found;
    if (users.length < 1000) break;
  }

  return null;
}

function roleTable(accountType) {
  return accountType === 'customer' ? 'profiles' : 'artists';
}

async function readLegacyPortalPassword(
  supabase,
  email,
  accountType,
  creatorRole
) {
  const portalRole = accountType === 'customer'
    ? 'customer'
    : normalizeCreatorRole(creatorRole).toLowerCase();

  const { data, error } = await supabase
    .from('portal_credentials')
    .select('password_hash')
    .eq('email', email)
    .eq('portal_role', portalRole)
    .maybeSingle();

  if (error) {
    // The legacy table may already have been removed. Direct role-row
    // credentials are the source of truth for all new and reset passwords.
    if (
      ['42P01', 'PGRST205'].includes(String(error.code || ''))
    ) {
      return null;
    }

    console.warn(
      'Legacy Artiste password lookup skipped:',
      error.message
    );

    return null;
  }

  return data?.password_hash || null;
}

async function migrateLegacyPasswordToRoleRow(
  supabase,
  profile,
  accountType,
  passwordHash
) {
  const { data, error } = await supabase
    .from(roleTable(accountType))
    .update({
      password_hash: encryptPortalPasswordHash(passwordHash),
    })
    .eq('id', profile.id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn(
      'Legacy password migration to portal row failed:',
      error.message
    );

    return false;
  }

  return Boolean(data?.id);
}

function databaseMigrationError(error) {
  return (
    ['42703', 'PGRST204'].includes(String(error?.code || '')) ||
    /password_hash.*(does not exist|schema cache)|column .*password_hash/i.test(
      String(error?.message || '')
    )
  );
}

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

    const creatorRole = normalizeCreatorRole(body.creatorRole);

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
    let profile;

    try {
      profile = await getPortalProfile(
        supabase,
        email,
        accountType,
        creatorRole
      );
    } catch (error) {
      if (databaseMigrationError(error)) {
        return NextResponse.json(
          {
            error: 'Portal password storage is not ready. Run the Artiste password_hash database migration, then try again.',
          },
          { status: 503 }
        );
      }

      throw error;
    }

    if (!profile) {
      return NextResponse.json(
        {
          error: accountType === 'artist'
            ? disciplineNotRegisteredMessage(creatorRole)
            : 'You are not registered as a Customer yet. Please click New User — Sign Up above to create a separate Customer account with its own password.',
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

    if (
      accountType === 'artist' &&
      String(profile.user_id || '') !== String(user.id)
    ) {
      const { data: linked, error: linkError } = await supabase
        .from('artists')
        .update({ user_id: user.id })
        .eq('id', profile.id)
        .eq('email', email)
        .select('id,user_id,email,creator_role,artist_name,phone,password_hash')
        .maybeSingle();

      if (linkError) throw linkError;

      if (!linked?.id) {
        return NextResponse.json(
          {
            error: 'Your Artist profile could not be securely linked to this verified email. Please sign in with email OTP or contact support.',
          },
          { status: 409 }
        );
      }

      profile = linked;
    }

    let storedHash = profile.password_hash || null;
    let usedLegacyHash = false;

    if (!storedHash) {
      storedHash = await readLegacyPortalPassword(
        supabase,
        email,
        accountType,
        creatorRole
      );

      usedLegacyHash = Boolean(storedHash);
    }

    if (!storedHash) {
      return NextResponse.json(
        {
          error: 'No password has been set for this specific portal yet. Choose Forgot Password and verify your email to create its independent password.',
        },
        { status: 401 }
      );
    }

    if (!verifyPortalPassword(storedHash, password)) {
      return NextResponse.json(
        {
          error: 'Incorrect password for this portal. Use Forgot Password to reset it with an email code.',
        },
        { status: 401 }
      );
    }

    if (
      usedLegacyHash ||
      !isEncryptedPortalPasswordHash(storedHash)
    ) {
      // A successful legacy login upgrades the credential to its required
      // location on the role row while preserving the salted scrypt hash.
      await migrateLegacyPasswordToRoleRow(
        supabase,
        profile,
        accountType,
        storedHash
      );
    }

    const established = createPortalSession({
      profile,
      user,
      email,
      accountType,
      creatorRole,
    });

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

    attachPortalSessionCookie(response, established.token);
    response.headers.set('Cache-Control', 'no-store');

    return response;
  } catch (error) {
    console.error(
      'Artiste password sign-in failed:',
      error?.stack || error?.message || error
    );

    const status = Number(error?.status);
    const responseStatus =
      Number.isInteger(status) && status >= 400 && status <= 599
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
