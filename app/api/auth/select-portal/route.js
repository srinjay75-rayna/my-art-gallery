import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { enforceRateLimit, rateLimitJsonResponse, readJsonBody } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['customer', 'artist']);

export async function POST(request) {
  try {
    const rate = await enforceRateLimit(request, {
      scope: 'auth-select-portal',
      limit: 20,
      windowSeconds: 60,
    });
    if (!rate.allowed) {
      return rateLimitJsonResponse(NextResponse, rate, 'Too many portal sign-in attempts. Please try again shortly.');
    }

    const body = await readJsonBody(request, 4 * 1024);
    const accountType = String(body.accountType || '').trim().toLowerCase();
    if (!ALLOWED.has(accountType)) {
      return NextResponse.json({ error: 'Choose the Customer or Artist portal.' }, { status: 400 });
    }

    const authorization = request.headers.get('authorization') || '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    const token = tokenMatch?.[1]?.trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in with your email and password first.' }, { status: 401 });
    }

    const supabase = requireServiceRole();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return NextResponse.json({ error: 'Your sign-in session is invalid or has expired.' }, { status: 401 });
    }

    const user = authData.user;
    if (!user.email_confirmed_at) {
      return NextResponse.json({ error: 'Please verify your email address before continuing.' }, { status: 403 });
    }

    let membership = null;
    let creatorRole = null;

    if (accountType === 'artist') {
      const { data, error } = await supabase
        .from('artists')
        .select('id,creator_role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      membership = data;
      creatorRole = data?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
    } else {
      // The current Artiste schema stores Customer accounts in public.profiles.
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      membership = data;
    }

    // V10's legacy Customer sign-up created public.profiles during onboarding,
    // not at OTP sign-up. Recover that specific legacy Customer state by
    // materialising its own profile row. Do not use metadata as a membership
    // check for Artist access; Artists must have an actual artists row.
    if (
      !membership &&
      accountType === 'customer' &&
      user.user_metadata?.account_type === 'customer' &&
      user.user_metadata?.brand === 'Artiste'
    ) {
      const { data, error } = await supabase.from('profiles').upsert({
        id: user.id,
        email: String(user.email || '').toLowerCase(),
        full_name: String(user.user_metadata?.full_name || '').slice(0, 100),
        phone: String(user.user_metadata?.phone || '').slice(0, 20),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' }).select('id').single();
      if (error) throw error;
      membership = data;
    }

    if (!membership) {
      return NextResponse.json({
        error: `This email does not have a ${accountType === 'artist' ? 'Artist' : 'Customer'} profile yet. Use New User — Sign Up on that portal to add it.`,
      }, { status: 403 });
    }

    const memberships = [...new Set([
      ...(Array.isArray(user.user_metadata?.portal_accounts)
        ? user.user_metadata.portal_accounts.filter((type) => ALLOWED.has(type))
        : []),
      accountType,
    ])];

    const nextMetadata = {
      ...(user.user_metadata || {}),
      account_type: accountType,
      portal_accounts: memberships,
      brand: 'Artiste',
      ...(accountType === 'artist' ? { creator_role: creatorRole } : {}),
    };

    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { user_metadata: nextMetadata }
    );
    if (updateError) throw updateError;

    return NextResponse.json({
      verified: true,
      accountType,
      creatorRole: accountType === 'artist' ? creatorRole : undefined,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: updateData?.user?.user_metadata || nextMetadata,
      },
    });
  } catch (error) {
    console.error('Artiste portal selection error:', error?.message || error);
    return NextResponse.json(
      { error: error.message || 'Could not verify this portal account.' },
      { status: Number(error?.status) || 400 }
    );
  }
}
