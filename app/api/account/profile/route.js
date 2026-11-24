import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROFILE_FIELDS = [
  'full_name',
  'phone',
  'address',
  'landmark',
  'locality',
  'city',
  'state',
  'pincode',
];

export async function GET(request) {
  try {
    // getUserFromRequest accepts the signed artiste_portal_session cookie as
    // well as the matching Authorization Bearer token.
    const user = await getUserFromRequest(request, { accountType: 'customer' });
    const supabase = requireServiceRole();
    const { data, error } = await supabase
      .from('profiles')
      .select('id,full_name,phone,address,landmark,locality,city,state,pincode')
      .eq('id', user.profileId || user.id)
      .maybeSingle();

    if (error) throw error;

    // Always return the same fields in both locations. This avoids consumers
    // losing the PIN when they expect a flat response instead of profile.*.
    const profile = Object.fromEntries(
      PROFILE_FIELDS.map((field) => [
        field,
        field === 'pincode'
          ? String(data?.[field] ?? '').replace(/\D/g, '').slice(0, 6)
          : String(data?.[field] ?? ''),
      ])
    );

    return NextResponse.json({
      email: user.email,
      userId: user.id,
      ...profile,
      profile,
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Could not load your saved delivery address.' },
      { status: Number(error?.status) || 500 },
    );
  }
}
