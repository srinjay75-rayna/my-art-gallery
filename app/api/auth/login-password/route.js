import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRole } from '@/lib/supabase';
import { enforceRateLimit, rateLimitJsonResponse, readJsonBody } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

function normalizeCreatorRole(value) {
  return value === 'Photographer' ? 'Photographer' : 'Painter';
}

function getPortalRole(accountType, creatorRole) {
  return accountType === 'customer'
    ? 'customer'
    : normalizeCreatorRole(creatorRole).toLowerCase();
}

function verifyPassword(encoded, password) {
  try {
    const parts = String(encoded || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);

    if (N !== 16384 || r !== 8 || p !== 1) return false;

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');

    if (salt.length !== 16 || expected.length !== 64) return false;

    const actual = crypto.scryptSync(
      String(password),
      salt,
      64,
      { N, r, p, maxmem: 64 * 1024 * 1024 }
    );

    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(
    String(password),
    salt,
    64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
  );
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase public URL and anon key are not configured.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function findAuthUser(supabase, email) {
  const lookups = await Promise.all([
    supabase.from('profiles').select('id').eq('email', email).limit(1),
    supabase.from('artists').select('user_id').eq('email', email).limit(2),
  ]);

  for (const result of lookups) {
    if (result.error) continue;
    for (const row of result.data || []) {
      const id = row.id || row.user_id;
      if (!id) continue;
      const { data, error } = await supabase.auth.admin.getUserById(id);
      if (!error && String(data?.user?.email || '').toLowerCase() === email) {
        return data.user;
      }
    }
  }

  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find(
      (item) => String(item.email || '').toLowerCase() === email
    );
    if (found) return found;
    if (users.length < 1000) break;
  }

  return null;
}

async function hasPortalMembership(supabase, user, accountType, creatorRole) {
  if (accountType === 'customer') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) return true;

    // Support older V10/V11 customer identities whose profile was created
    // during onboarding rather than at initial OTP sign-up.
    if (
      user.user_metadata?.account_type === 'customer' &&
      user.user_metadata?.brand === 'Artiste'
    ) {
      const { error: insertError } = await supabase.from('profiles').upsert({
        id: user.id,
        email: String(user.email || '').toLowerCase(),
        full_name: String(user.user_metadata?.full_name || '').slice(0, 100),
        phone: String(user.user_metadata?.phone || '').slice(0, 20),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (insertError) throw insertError;
      return true;
    }

    return false;
  }

  const role = normalizeCreatorRole(creatorRole);

  let { data, error } = await supabase
    .from('artists')
    .select('id,creator_role')
    .eq('user_id', user.id)
    .eq('creator_role', role)
    .maybeSingle();

  if (error) throw error;
  if (data) return true;

  if (role === 'Painter') {
    const legacy = await supabase
      .from('artists')
      .select('id')
      .eq('user_id', user.id)
      .is('creator_role', null)
      .maybeSingle();

    if (legacy.error) throw legacy.error;
    return Boolean(legacy.data);
  }

  return false;
}

async function issueSession(supabase, user, email, accountType, creatorRole) {
  const metadata = {
    ...(user.user_metadata || {}),
    account_type: accountType,
    brand: 'Artiste',
    portal_accounts: [...new Set([
      ...(Array.isArray(user.user_metadata?.portal_accounts)
        ? user.user_metadata.portal_accounts.filter((item) => ['customer', 'artist'].includes(item))
        : []),
      accountType,
    ])],
    ...(accountType === 'artist'
      ? { creator_role: normalizeCreatorRole(creatorRole) }
      : {}),
  };

  const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    {
      user_metadata: metadata,
      ...(user.email_confirmed_at ? {} : { email_confirm: true }),
    }
  );

  if (updateError || !updated?.user) {
    throw updateError || new Error('Could not select your Artiste portal.');
  }

  const link = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (link.error || !link.data?.user) {
    throw link.error || new Error('Could not create your portal session.');
  }

  const tokenHash =
    link.data?.properties?.hashed_token ||
    link.data?.hashed_token;

  if (!tokenHash) throw new Error('Supabase did not return a sign-in token.');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
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
      user_metadata: verified.user?.user_metadata || metadata,
      email_confirmed_at: verified.user?.email_confirmed_at || user.email_confirmed_at,
    },
  };
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
    const email = String(body.email || '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const accountType = String(body.accountType || '').trim().toLowerCase();
    const creatorRole = normalizeCreatorRole(body.creatorRole);

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    if (!['customer', 'artist'].includes(accountType)) {
      return NextResponse.json({ error: 'Choose Customer or Artist sign-in.' }, { status: 400 });
    }

    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return NextResponse.json({
        error: `Your password must contain ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
      }, { status: 400 });
    }

    const supabase = requireServiceRole();
    const user = await findAuthUser(supabase, email);

    if (!user || !user.email_confirmed_at) {
      return NextResponse.json({
        error: 'No verified Artiste account was found for this email. Sign up or verify your email first.',
      }, { status: 404 });
    }

    const membership = await hasPortalMembership(
      supabase,
      user,
      accountType,
      creatorRole
    );

    if (!membership) {
      const label = accountType === 'customer' ? 'Customer' : creatorRole;
      return NextResponse.json({
        error: `This email does not have a ${label} profile. Use New User — Sign Up to create it.`,
      }, { status: 403 });
    }

    const role = getPortalRole(accountType, creatorRole);

    const { data: credential, error: credentialError } = await supabase
      .from('portal_credentials')
      .select('password_hash')
      .eq('email', email)
      .eq('portal_role', role)
      .maybeSingle();

    if (credentialError) {
      console.error('Portal credential lookup failed:', credentialError.message);
      return NextResponse.json({
        error: 'Independent portal passwords are not ready. Run database/schema.sql in Supabase.',
      }, { status: 503 });
    }

    if (credential?.password_hash) {
      if (!verifyPassword(credential.password_hash, password)) {
        return NextResponse.json({
          error: 'Incorrect password for this portal. Use Forgot password to reset it with an email code.',
        }, { status: 401 });
      }
    } else {
      // One-time compatibility migration for V11/V12 accounts that used a
      // shared Supabase Auth password. Once migrated, this portal uses only
      // its own role-specific scrypt hash.
      const legacy = createAnonClient();
      const { data: legacyData, error: legacyError } =
        await legacy.auth.signInWithPassword({ email, password });

      if (legacyError || !legacyData?.user) {
        return NextResponse.json({
          error: 'Incorrect password for this portal. Use Forgot password to set an independent portal password.',
        }, { status: 401 });
      }

      await legacy.auth.signOut({ scope: 'local' });

      const { error: saveError } = await supabase.from('portal_credentials').upsert({
        email,
        portal_role: role,
        password_hash: hashPassword(password),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email,portal_role' });

      if (saveError) {
        console.error('Legacy portal password migration failed:', saveError.message);
        return NextResponse.json({
          error: 'Your legacy password was accepted, but its independent portal credential could not be saved. Run database/schema.sql and try again.',
        }, { status: 503 });
      }
    }

    const established = await issueSession(
      supabase,
      user,
      email,
      accountType,
      creatorRole
    );

    return NextResponse.json({
      verified: true,
      accountType,
      creatorRole: accountType === 'artist' ? creatorRole : undefined,
      session: established.session,
      user: established.user,
      message: 'You are signed in to your selected Artiste portal.',
    });

  } catch (error) {
    console.error('Artiste password sign-in failed:', error?.message || error);
    const status = Number(error?.status);
    return NextResponse.json(
      {
        error: Number.isInteger(status) && status >= 400 && status < 500
          ? error.message
          : 'Could not sign in right now. Please try again or use email OTP verification.',
      },
      { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500 }
    );
  }
}
