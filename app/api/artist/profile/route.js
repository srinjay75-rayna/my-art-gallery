import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth-server';
import { normaliseIndianPhone } from '@/lib/india-address';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    const supabase = requireServiceRole();
    const { data: artist, error } = await supabase.from('artists').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    let ledger = [];
    let payoutAccount = null;
    if (artist) {
      const { data: payouts, error: payoutError } = await supabase.from('artist_payouts').select('id,order_id,order_ref,artist_name,gross_amount,platform_fee,artist_payout,payout_status,paid_at,created_at').eq('artist_id', artist.id).order('created_at', { ascending: false });
      if (payoutError) throw payoutError;
      ledger = payouts || [];
      const { data: payout, error: payoutAccountError } = await supabase.from('artist_payout_accounts').select('artist_id,account_holder_name,bank_account_number_masked,ifsc_code,bank_name,branch_name,upi_id,verified_at,updated_at').eq('artist_id', artist.id).maybeSingle();
      if (payoutAccountError) throw payoutAccountError;
      payoutAccount = payout || null;
    }
    return NextResponse.json({ artist, ledger, payoutAccount, user: { id: user.id, email: user.email } });
  } catch (error) { return NextResponse.json({ error: error.message || 'Please verify your email and sign in.' }, { status: 401 }); }
}

export async function POST(request) {
  let uploaded = null;
  try {
    const user = await getUserFromRequest(request);
    const form = await request.formData();
    const artistName = String(form.get('artist_name') || '').trim();
    const bio = String(form.get('bio') || '').trim();
    const city = String(form.get('city') || '').trim();
    const state = String(form.get('state') || '').trim();
    const pickupAddress = String(form.get('pickup_address') || '').trim();
    const pickupContactName = String(form.get('pickup_contact_name') || '').trim();
    const pickupPhoneDigits = normaliseIndianPhone(form.get('pickup_phone')); 
    const pickupLandmark = String(form.get('pickup_landmark') || '').trim();
    const pickupLocality = String(form.get('pickup_locality') || '').trim();
    const pickupPincode = String(form.get('pickup_pincode') || '').trim();
    const pickupLocation = String(form.get('pickup_location') || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary').trim();
    const photo = form.get('photo');
    if (!artistName || artistName.length > 100 || !bio || bio.length > 1200 || !city || !state || !pickupAddress || !pickupContactName || !/^\d{10}$/.test(pickupPhoneDigits) || !pickupLandmark || !pickupLocality || !/^\d{6}$/.test(pickupPincode) || !pickupLocation) {
      return NextResponse.json({ error: 'Complete your Artist name, bio, pickup contact name, +91 mobile number, street address, landmark, locality, city, State / UT and valid 6-digit pickup PIN code.' }, { status: 400 });
    }
    const supabase = requireServiceRole();
    const { data: existing, error: existingError } = await supabase.from('artists').select('id,profile_photo_url,is_approved').eq('user_id', user.id).maybeSingle();
    if (existingError) throw existingError;
    let profilePhotoUrl = existing?.profile_photo_url || null;
    if (photo && typeof photo.arrayBuffer === 'function' && photo.size > 0) {
      if (!types.has(photo.type) || photo.size > 6 * 1024 * 1024) return NextResponse.json({ error: 'Use a JPG, PNG, WEBP, or AVIF profile photo up to 6 MB.' }, { status: 400 });
      uploaded = `${user.id}/${crypto.randomUUID()}.${ext[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('artist-profiles').upload(uploaded, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      profilePhotoUrl = supabase.storage.from('artist-profiles').getPublicUrl(uploaded).data.publicUrl;
    }
    if (!profilePhotoUrl) return NextResponse.json({ error: 'Please upload a portfolio/profile photo.' }, { status: 400 });
    const row = { user_id: user.id, email: String(user.email || '').toLowerCase(), artist_name: artistName, bio, city, state, profile_photo_url: profilePhotoUrl, pickup_address: pickupAddress, pickup_contact_name: pickupContactName, pickup_phone: `+91${pickupPhoneDigits}`, pickup_landmark: pickupLandmark, pickup_locality: pickupLocality, pickup_pincode: pickupPincode, pickup_location: pickupLocation, is_approved: existing?.is_approved || false };
    const { data, error } = await supabase.from('artists').upsert(row, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    const { error: attributionError } = await supabase.from('paintings').update({ artist_name: artistName }).eq('artist_id', data.id).eq('is_sold', false);
    if (attributionError) throw attributionError;
    return NextResponse.json({ artist: data, message: data.is_approved ? 'Artist profile updated.' : 'Artist profile submitted. The Artiste team will review it before public listing.' }, { status: 201 });
  } catch (error) {
    if (uploaded) { try { await requireServiceRole().storage.from('artist-profiles').remove([uploaded]); } catch {} }
    return NextResponse.json({ error: error.message || 'Could not save Artist profile.' }, { status: 400 });
  }
}
