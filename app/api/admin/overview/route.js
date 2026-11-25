import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';
import { decryptPayoutValue } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchAll(makeQuery) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await makeQuery().range(start, start + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const [artists, orders, payouts, shipments, payoutAccounts] = await Promise.all([
      fetchAll(() => supabase.from('artists').select('*').order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('orders').select('*').order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('artist_payouts').select('*').order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('order_shipments').select('*').order('group_index', { ascending: true })),
      // Only the owner-authenticated dashboard receives a decrypted account number; ciphertext never leaves the server.
      fetchAll(() => supabase.from('artist_payout_accounts').select('artist_id,account_holder_name,bank_account_number_encrypted,bank_account_number_masked,ifsc_code,bank_name,branch_name,bank_address,bank_city,bank_state,upi_id,verified_at,updated_at')),
    ]);
    const revealPayoutAccount = (account) => {
      if (!account) return null;
      let bankAccountNumber = '';
      try { if (account.bank_account_number_encrypted) bankAccountNumber = decryptPayoutValue(account.bank_account_number_encrypted); }
      catch (error) { console.error('Payout account decryption failed:', error.message); }
      const { bank_account_number_encrypted, ...safe } = account;
      return { ...safe, bank_account_number: bankAccountNumber };
    };
    const artistById = new Map(artists.map((artist) => [artist.id, artist]));
    const accountByArtist = new Map(payoutAccounts.map((account) => [account.artist_id, revealPayoutAccount(account)]));
    const shipmentsByOrder = new Map();
    for (const shipment of shipments) {
      const artist = artistById.get(shipment.artist_id) || null;
      const group = shipmentsByOrder.get(shipment.order_id) || [];
      group.push({
        ...shipment,
        artist_dispatch: artist ? {
          artist_name: artist.artist_name,
          email: artist.email,
          pickup_contact_name: artist.pickup_contact_name,
          pickup_phone: artist.pickup_phone,
          pickup_address: artist.pickup_address,
          pickup_landmark: artist.pickup_landmark,
          pickup_locality: artist.pickup_locality,
          city: artist.city,
          state: artist.state,
          pickup_pincode: artist.pickup_pincode,
          pickup_location: artist.pickup_location,
        } : null,
        payout_account: (shipment.payout_info && Object.keys(shipment.payout_info).length) ? {
          ...shipment.payout_info,
          bank_account_number: (() => { try { return shipment.payout_info.bank_account_number_encrypted ? decryptPayoutValue(shipment.payout_info.bank_account_number_encrypted) : (accountByArtist.get(shipment.artist_id)?.bank_account_number || ''); } catch (error) { console.error('Order payout snapshot decryption failed:', error.message); return ''; } })(),
        } : (accountByArtist.get(shipment.artist_id) || null),
      });
      shipmentsByOrder.set(shipment.order_id, group);
    }
    const enrichedOrders = orders.map((order) => ({
      ...order,
      shipments: shipmentsByOrder.get(order.id) || [],
    }));
    const enrichedArtists = artists.map((artist) => ({
      ...artist,
      payout_account: accountByArtist.get(artist.id) || null,
    }));
    const enrichedPayouts = await Promise.all(payouts.map(async (payout) => {
      if (!payout.payout_proof_url) return payout;
      const { data: signed } = await supabase.storage.from('payout-proofs').createSignedUrl(payout.payout_proof_url, 60 * 60);
      return { ...payout, payout_proof_signed_url: signed?.signedUrl || '' };
    }));
    return NextResponse.json({ artists: enrichedArtists, orders: enrichedOrders, payouts: enrichedPayouts });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load admin overview.' }, { status: 500 });
  }
}
