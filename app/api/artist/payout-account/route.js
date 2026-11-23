import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { encryptPayoutValue, maskBankAccount } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getArtistForPortal(supabase, user) {
  const role = user.user_metadata?.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
  let { data, error } = await supabase.from('artists').select('*').eq('user_id', user.id).eq('creator_role', role).maybeSingle();
  if (error) throw error;
  if (!data && role === 'Painter') {
    const legacy = await supabase.from('artists').select('*').eq('user_id', user.id).is('creator_role', null).maybeSingle();
    if (legacy.error) throw legacy.error;
    data = legacy.data || null;
  }
  return data;
}

async function lookupIfsc(ifsc) {
  const response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (response.status === 404) throw new Error('The IFSC code was not found in the Razorpay IFSC directory.');
  if (!response.ok) throw new Error('The IFSC verification service is temporarily unavailable.');
  const data = await response.json();
  if (String(data.IFSC || '').toUpperCase() !== ifsc || !data.BANK || !data.BRANCH) throw new Error('The IFSC details could not be verified.');
  return data;
}

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ account: null });
    const { data, error } = await supabase.from('artist_payout_accounts')
      .select('artist_id,account_holder_name,bank_account_number_masked,ifsc_code,bank_name,branch_name,upi_id,verified_at,updated_at')
      .eq('artist_id', artist.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ account: data || null });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not load payout details.' }, { status: 401 }); }
}

export async function POST(request) {
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const body = await request.json();
    const accountHolder = String(body.account_holder_name || '').trim();
    const accountNumber = String(body.bank_account_number || '').replace(/\s/g, '');
    const confirmNumber = String(body.confirm_bank_account_number || '').replace(/\s/g, '');
    const ifsc = String(body.ifsc_code || '').trim().toUpperCase();
    const upi = String(body.upi_id || '').trim();
    if (accountHolder.length < 2 || accountHolder.length > 120) return NextResponse.json({ error: 'Enter the bank account holder name.' }, { status: 400 });
    if (!/^\d{8,20}$/.test(accountNumber)) return NextResponse.json({ error: 'Enter a bank account number containing 8–20 digits.' }, { status: 400 });
    if (accountNumber !== confirmNumber) return NextResponse.json({ error: 'Bank account number and confirmation do not match.' }, { status: 400 });
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return NextResponse.json({ error: 'Enter a valid 11-character IFSC code.' }, { status: 400 });
    if (upi && !/^[\w.-]{2,256}@[\w.-]{2,64}$/.test(upi)) return NextResponse.json({ error: 'Enter a valid UPI ID, or leave it blank.' }, { status: 400 });

    const supabase = requireServiceRole();
    const artist = await getArtistForPortal(supabase, user);
    if (!artist) return NextResponse.json({ error: 'Save your Artist profile and pickup address before adding payout details.' }, { status: 409 });
    const bank = await lookupIfsc(ifsc);
    const encrypted = encryptPayoutValue(accountNumber);
    const { data, error } = await supabase.from('artist_payout_accounts').upsert({
      artist_id: artist.id,
      user_id: user.id,
      account_holder_name: accountHolder,
      bank_account_number_encrypted: encrypted,
      bank_account_number_masked: maskBankAccount(accountNumber),
      ifsc_code: ifsc,
      bank_name: String(bank.BANK),
      branch_name: String(bank.BRANCH),
      bank_address: String(bank.ADDRESS || ''),
      bank_city: String(bank.CITY || ''),
      bank_state: String(bank.STATE || ''),
      upi_id: upi || null,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'artist_id' })
      .select('artist_id,account_holder_name,bank_account_number_masked,ifsc_code,bank_name,branch_name,upi_id,verified_at,updated_at').single();
    if (error) throw error;
    // Profile + verified payout details complete the Artist onboarding.
    // Activate the studio immediately unless the owner has explicitly suspended it.
    const { data: currentArtist, error: artistReadError } = await supabase.from('artists').select('id,is_suspended,artist_name,avatar_url,profile_photo_url').eq('id', artist.id).single();
    if (artistReadError) throw artistReadError;
    if (!currentArtist.is_suspended) {
      const { error: activateError } = await supabase.from('artists').update({ is_approved: true }).eq('id', artist.id).eq('is_suspended', false);
      if (activateError) throw activateError;
      const { error: publishError } = await supabase.from('paintings').update({
        is_approved: true,
        artist_name: currentArtist.artist_name,
        avatar_url: currentArtist.avatar_url || currentArtist.profile_photo_url || '',
      }).eq('artist_id', artist.id).eq('is_sold', false);
      if (publishError) throw publishError;
    }
    return NextResponse.json({ account: data, message: currentArtist.is_suspended ? 'Payout details saved. Your Artist studio remains suspended by the Artiste owner.' : 'Your IFSC was verified, payout details were securely saved, and your Artist studio is now active.' });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save verified payout details.' }, { status: 400 });
  }
}
