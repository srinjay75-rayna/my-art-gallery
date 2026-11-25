import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authenticated = await isAdminRequest();
  return NextResponse.json({ authenticated }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
