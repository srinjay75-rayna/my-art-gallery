import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { enforceRateLimit, rateLimitJsonResponse, readJsonBody } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedAccountTypes = new Set(['customer', 'artist']);
const allowedPurposes = new Set(['login', 'signup']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function otpHash({ email, accountType, purpose, code }) {
  const key = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set OTP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY on the server.');
  return crypto.createHmac('sha256', key)
    .update(`${email}|${accountType}|${purpose}|${code}`)
    .digest('hex');
}


async function findExistingAuthUserByEmail(supabase, email) {
  // Newer Artiste migrations maintain a private normalized email index in the
  // profile row. Fall back to paged Auth Admin search for older unmigrated data.
  const { data: identity, error: identityError } = await supabase
    .from('profiles').select('id').eq('email', email).maybeSingle();
  if (identityError) throw identityError;
  if (identity?.id) {
    const { data, error } = await supabase.auth.admin.getUserById(identity.id);
    if (error) throw error;
    // Never trust a profile-row email as Auth identity proof: customers can
    // edit their own profile row, while the authoritative address lives in
    // auth.users. If the values differ, fall back to the Auth Admin directory.
    if (String(data?.user?.email || '').toLowerCase() === email) return data.user;
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

function safeMessage(error) {
  const value = String(error?.message || 'Authentication could not be completed.');
  if (/already registered|already been registered|user already exists/i.test(value)) {
    return 'An account already exists for this email. Choose Existing User — Log In instead.';
  }
  return value;
}

export async function POST(request) {
  try {
    const rate = await enforceRateLimit(request, { scope: 'otp-verify', limit: 40, windowSeconds: 15 * 60 });
    if (!rate.allowed) return rateLimitJsonResponse(NextResponse, rate, 'Too many verification attempts from this connection. Please wait before trying again.');
    const body = await readJsonBody(request, 8 * 1024);
    const email = String(body.email || '').trim().toLowerCase();
    const accountType = String(body.accountType || '').trim().toLowerCase();
    const purpose = String(body.purpose || '').trim().toLowerCase();
    const code = String(body.otp || '').trim();
    const password = String(body.password || '').slice(0, 256);

    if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    if (!allowedAccountTypes.has(accountType) || !allowedPurposes.has(purpose)) return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 });
    if (purpose === 'signup' && password.length < 8) return NextResponse.json({ error: 'Your password must contain at least 8 characters.' }, { status: 400 });

    const supabase = requireServiceRole();
    const suppliedHash = otpHash({ email, accountType, purpose, code });
    const { data: consumed, error: consumeError } = await supabase.rpc('consume_email_otp', {
      p_email: email,
      p_account_type: accountType,
      p_purpose: purpose,
      p_otp_hash: suppliedHash,
    });
    if (consumeError) {
      console.error('Artiste consume OTP error:', consumeError.message);
      return NextResponse.json({ error: 'The OTP verification database function is unavailable. Run the updated database/schema.sql in Supabase.' }, { status: 503 });
    }
    const result = Array.isArray(consumed) ? consumed[0] : consumed;
    if (!result?.is_valid) return NextResponse.json({ error: 'That code is invalid, expired, or already used. Request a new 6-digit code.' }, { status: 400 });

    let user;
    let sessionLink;
    if (purpose === 'signup') {
      const payload = result.payload && typeof result.payload === 'object' ? result.payload : {};
      if (payload.account_type !== accountType) return NextResponse.json({ error: 'The verification request does not match this portal.' }, { status: 400 });
      const creatorRole = payload.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      const metadata = accountType === 'artist'
        ? { ...payload, account_type: 'artist', creator_role: creatorRole, brand: 'Artiste' }
        : { ...payload, account_type: 'customer', brand: 'Artiste' };
      const createResult = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (createResult.error || !createResult.data?.user) {
        throw createResult.error || new Error('Could not create your Artiste account.');
      }
      user = createResult.data.user;
      if (accountType === 'artist') {
        // Persist the chosen discipline immediately after OTP verification,
        // before the first dashboard render. Auth metadata remains a durable
        // recovery source if the public profile insert experiences a transient DB failure.
        const { error: draftError } = await supabase.from('artists').upsert({
          user_id: user.id,
          email,
          artist_name: String(metadata.artist_name || metadata.full_name || 'Artist').slice(0, 100),
          creator_role: creatorRole,
          bio: '',
          city: '',
          state: '',
          pickup_address: '',
          pickup_contact_name: String(metadata.artist_name || metadata.full_name || 'Artist').slice(0, 100),
          pickup_phone: String(metadata.phone || ''),
          pickup_landmark: '',
          pickup_locality: '',
          pickup_pincode: '',
          pickup_location: 'Primary',
          is_approved: false,
          is_suspended: false,
        }, { onConflict: 'user_id' });
        if (draftError) console.error('Artiste draft Artist profile will be recreated on first profile load:', draftError.message);
      }
    } else {
      user = await findExistingAuthUserByEmail(supabase, email);
      if (!user) {
        return NextResponse.json({ error: 'No existing account was found for this email. Choose New User — Sign Up to join Artiste.' }, { status: 404 });
      }
      // Supabase Auth's Admin token generator is used only as an internal
      // session issuer after our independent six-digit SMTP code is consumed.
      // No action link is emailed, returned to the browser, or opened by user.
      const generated = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
      if (generated.error || !generated.data?.user) {
        throw generated.error || new Error('Could not issue a verified session for this account.');
      }
      sessionLink = generated;
      user = generated.data.user;
      let actualType = user.user_metadata?.account_type || '';
      if (!actualType) {
        const { data: artistRecord, error: artistLookupError } = await supabase.from('artists').select('id').eq('user_id', user.id).maybeSingle();
        if (artistLookupError) throw artistLookupError;
        actualType = artistRecord ? 'artist' : 'customer';
      }
      if (actualType !== accountType) {
        return NextResponse.json({ error: `This email belongs to the ${actualType === 'artist' ? 'Artist' : 'Customer'} portal.` }, { status: 403 });
      }
      const authUpdate = {};
      let artistRecord = null;
      if (accountType === 'artist') {
        const { data: roleRecord, error: roleLookupError } = await supabase.from('artists').select('id,creator_role').eq('user_id', user.id).maybeSingle();
        if (roleLookupError) throw roleLookupError;
        artistRecord = roleRecord;
      }
      const nextMetadata = { ...(user.user_metadata || {}), account_type: accountType, brand: 'Artiste' };
      if (accountType === 'artist' && !['Painter', 'Photographer'].includes(nextMetadata.creator_role)) {
        nextMetadata.creator_role = artistRecord?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      }
      if (!user.user_metadata?.account_type || (accountType === 'artist' && !user.user_metadata?.creator_role)) {
        authUpdate.user_metadata = nextMetadata;
      }
      // The independently verified Artiste OTP proves inbox access, so it can
      // also confirm legacy Auth users whose Supabase email was still pending.
      if (!user.email_confirmed_at) authUpdate.email_confirm = true;
      if (Object.keys(authUpdate).length) {
        const updateResult = await supabase.auth.admin.updateUserById(user.id, authUpdate);
        if (updateResult.error) throw updateResult.error;
        user = updateResult.data.user;
        // Re-mint after the account update so the session carries current claims.
        sessionLink = null;
      }
    }

    // For a new signup this creates a one-time, server-side-only session token.
    // It is immediately consumed below, then only the resulting JWT session is
    // returned over HTTPS to the same browser tab that submitted the OTP.
    if (!sessionLink) {
      sessionLink = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    }
    if (sessionLink.error) throw sessionLink.error;
    const tokenHash = sessionLink.data?.properties?.hashed_token || sessionLink.data?.hashed_token;
    if (!tokenHash) throw new Error('Supabase did not issue a sign-in session. Check your Auth configuration.');

    const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });
    if (verifyError || !verified?.session) throw verifyError || new Error('Could not establish your Artiste session.');

    return NextResponse.json({
      verified: true,
      accountType,
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
    return NextResponse.json({ error: safeMessage(error) }, { status: Number(error?.status) || 400 });
  }
}
