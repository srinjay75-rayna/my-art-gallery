import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth-server';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    await getUserFromRequest(request, { accountType: 'artist' });
    const ifsc = String(new URL(request.url).searchParams.get('ifsc') || '').trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return NextResponse.json({ error: 'Enter a valid 11-character IFSC code.' }, { status: 400 });
    const response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.status === 404) return NextResponse.json({ error: 'This IFSC code was not found in the Razorpay IFSC directory.' }, { status: 404 });
    if (!response.ok) return NextResponse.json({ error: 'The IFSC verification service is temporarily unavailable. Try again.' }, { status: 503 });
    const data = await response.json();
    if (String(data.IFSC || '').toUpperCase() !== ifsc || !data.BANK || !data.BRANCH) return NextResponse.json({ error: 'The IFSC response could not be verified. Check the code and retry.' }, { status: 422 });
    return NextResponse.json({ verified: true, ifsc, bank_name: data.BANK, branch_name: data.BRANCH, address: data.ADDRESS || '', city: data.CITY || '', district: data.DISTRICT || '', state: data.STATE || '' });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Please verify your email and try again.' }, { status: 401 });
  }
}
