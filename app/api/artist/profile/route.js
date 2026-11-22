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
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const supabase = requireServiceRole();
    const { data: foundArtist, error } = await supabase.from('artists').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    let artist = foundArtist || null;
    if (!artist) {
      const metadata = user.user_metadata || {};
      const creatorRole = metadata.creator_role === 'Photographer' ? 'Photographer' : 'Painter';
      const draftName = String(metadata.artist_name || metadata.full_name || 'Artist').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 100) || 'Artist';
      const { data: draft, error: draftError } = await supabase.from('artists').upsert({
        user_id: user.id,
        email: String(user.email || '').toLowerCase(),
        artist_name: draftName,
        creator_role: creatorRole,
        is_approved: false,
        is_suspended: false,
      }, { onConflict: 'user_id' }).select('*').single();
      if (draftError) throw draftError;
      artist = draft;
    }
    let ledger = [];
    let payoutAccount = null;
    if (artist) {
      const [{ data: payouts, error: payoutError }, { data: payout, error: payoutAccountError }] = await Promise.all([
        supabase.from('artist_payouts').select('id,order_id,order_ref,artist_name,creator_role,commission_rate,gross_amount,platform_fee,artist_payout,payout_status,paid_at,created_at').eq('artist_id', artist.id).order('created_at', { ascending: false }),
        supabase.from('artist_payout_accounts').select('artist_id,account_holder_name,bank_account_number_masked,ifsc_code,bank_name,branch_name,upi_id,verified_at,updated_at').eq('artist_id', artist.id).maybeSingle(),
      ]);
      if (payoutError) throw payoutError;
      if (payoutAccountError) throw payoutAccountError;
      ledger = payouts || [];
      payoutAccount = payout || null;

      const profileComplete = Boolean(artist.artist_name && artist.bio && artist.pickup_address && artist.pickup_phone && artist.pickup_landmark && artist.pickup_locality && artist.city && artist.state && /^\d{6}$/.test(String(artist.pickup_pincode || '')));
      // Automatically activate complete, IFSC-verified studios. The explicit
      // owner-controlled is_suspended flag always takes precedence.
      if (profileComplete && payoutAccount?.verified_at && !artist.is_suspended && !artist.is_approved) {
        const { data: activated, error: activateError } = await supabase.from('artists').update({ is_approved: true }).eq('id', artist.id).eq('is_suspended', false).select('*').single();
        if (activateError) throw activateError;
        artist = activated;
        const { error: paintingsError } = await supabase.from('paintings').update({ is_approved: true, artist_name: artist.artist_name, avatar_url: artist.avatar_url || artist.profile_photo_url || '' }).eq('artist_id', artist.id).eq('is_sold', false);
        if (paintingsError) throw paintingsError;
      }
    }
    if (artist) artist = { ...artist, avatar_url: artist.avatar_url || artist.profile_photo_url || '' };
    return NextResponse.json({ artist, ledger, payoutAccount, user: { id: user.id, email: user.email } });
  } catch (error) { return NextResponse.json({ error: error.message || 'Please verify your email and sign in.' }, { status: 401 }); }
}

export async function POST(request) {
  let uploaded = null;
  try {
    const user = await getUserFromRequest(request, { accountType: 'artist' });
    const form = await request.formData();
    const artistName = String(form.get('artist_name') || '').trim();
    const creatorRole = form.get('creator_role') === 'Photographer' ? 'Photographer' : 'Painter';
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
    const { data: existing, error: existingError } = await supabase.from('artists').select('id,profile_photo_url,avatar_url,is_approved,is_suspended,creator_role').eq('user_id', user.id).maybeSingle();
    if (existingError) throw existingError;
    let profilePhotoUrl = existing?.avatar_url || existing?.profile_photo_url || '';
    if (photo && typeof photo.arrayBuffer === 'function' && photo.size > 0) {
      if (!types.has(photo.type) || photo.size > 6 * 1024 * 1024) return NextResponse.json({ error: 'Use a JPG, PNG, WEBP, or AVIF profile photo up to 6 MB.' }, { status: 400 });
      uploaded = `${user.id}/${crypto.randomUUID()}.${ext[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('artist-profiles').upload(uploaded, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      profilePhotoUrl = supabase.storage.from('artist-profiles').getPublicUrl(uploaded).data.publicUrl;
    }
    const row = {
      user_id: user.id,
      email: String(user.email || '').toLowerCase(),
      artist_name: artistName,
      creator_role: creatorRole,
      bio,
      city,
      state,
      profile_photo_url: profilePhotoUrl,
      avatar_url: profilePhotoUrl,
      pickup_address: pickupAddress,
      pickup_contact_name: pickupContactName,
      pickup_phone: `+91${pickupPhoneDigits}`,
      pickup_landmark: pickupLandmark,
      pickup_locality: pickupLocality,
      pickup_pincode: pickupPincode,
      pickup_location: pickupLocation,
      is_suspended: Boolean(existing?.is_suspended),
      // The payout-account endpoint activates the Artist as soon as the
      // profile and verified bank details are both complete.
      is_approved: Boolean(existing?.is_approved && !existing?.is_suspended),
    };
    const { data: saved, error } = await supabase.from('artists').upsert(row, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    let data = saved;
    const { data: payoutStatus, error: payoutStatusError } = await supabase.from('artist_payout_accounts').select('verified_at').eq('artist_id', saved.id).maybeSingle();
    if (payoutStatusError) throw payoutStatusError;
    if (payoutStatus?.verified_at && !saved.is_suspended) {
      const { data: activated, error: activateError } = await supabase.from('artists').update({ is_approved: true }).eq('id', saved.id).eq('is_suspended', false).select('*').single();
      if (activateError) throw activateError;
      data = activated;
    }
    try {
      const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { ...(user.user_metadata || {}), account_type: 'artist', artist_name: artistName, creator_role: creatorRole, brand: 'Artiste' },
      });
      if (metadataError) console.error('Could not sync Artist role to Auth metadata:', metadataError.message);
    } catch (metadataError) { console.error('Could not sync Artist role to Auth metadata:', metadataError?.message || metadataError); }
    const { error: attributionError } = await supabase.from('paintings').update({
      artist_name: artistName,
      avatar_url: profilePhotoUrl,
      ...(data.is_approved && !data.is_suspended ? { is_approved: true } : {}),
    }).eq('artist_id', data.id).eq('is_sold', false);
    if (attributionError) throw attributionError;
    const message = data.is_suspended
      ? 'Your Artist profile details were saved. Your studio is currently suspended by the Artiste owner.'
      : data.is_approved
        ? 'Your Artist studio is active. You can publish artwork immediately.'
        : 'Artist profile saved. Complete your IFSC-verified payout details to activate your studio.';
    return NextResponse.json({ artist: { ...data, avatar_url: data.avatar_url || data.profile_photo_url || '' }, message }, { status: 201 });
  } catch (error) {
    if (uploaded) { try { await requireServiceRole().storage.from('artist-profiles').remove([uploaded]); } catch {} }
    return NextResponse.json({ error: error.message || 'Could not save Artist profile.' }, { status: 400 });
  }
}
