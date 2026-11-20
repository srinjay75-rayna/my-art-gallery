import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, createAdminToken, passwordMatches } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { password } = await request.json();
    if (!passwordMatches(password)) return NextResponse.json({ error: 'Incorrect admin password.' }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, createAdminToken(), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      path: '/', maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Unable to sign in.' }, { status: 500 });
  }
}
