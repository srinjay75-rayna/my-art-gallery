import { NextResponse } from 'next/server';
import { clearPortalSessionCookie } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ signedOut: true });

  clearPortalSessionCookie(response);
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
