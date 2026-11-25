import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf']);
const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

export async function POST(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  let uploadedPath = '';
  let paymentRecorded = false;
  const supabase = requireServiceRole();
  try {
    const form = await request.formData();
    const payoutId = String(form.get('payout_id') || '').trim();
    const amount = Math.round(Number(form.get('amount_paid')) * 100) / 100;
    const utr = String(form.get('utr') || '').trim().slice(0, 150);
    const proof = form.get('proof');
    if (!payoutId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Enter a valid payout and payment amount.' }, { status: 400 });
    }
    if (!proof || typeof proof.arrayBuffer !== 'function' || proof.size <= 0) {
      return NextResponse.json({ error: 'A payment proof photo or PDF receipt is mandatory.' }, { status: 400 });
    }
    if (!allowedTypes.has(proof.type) || proof.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Upload a JPG, PNG, WEBP, AVIF or PDF file up to 10 MB.' }, { status: 400 });
    }
    const { data: existing, error: lookupError } = await supabase
      .from('artist_payouts')
      .select('id,artist_name,artist_payout,payout_paid_amount,payout_status,payout_available_at')
      .eq('id', payoutId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return NextResponse.json({ error: 'Artist payout ledger entry not found.' }, { status: 404 });
    if (!existing.payout_available_at || new Date(existing.payout_available_at).getTime() > Date.now()) {
      return NextResponse.json({ error: 'Payout can only be recorded after Delivered + 48 hours.' }, { status: 409 });
    }
    const alreadyPaid = Number(existing.payout_paid_amount || 0) || (['paid', 'Paid'].includes(existing.payout_status) ? Number(existing.artist_payout || 0) : 0);
    const remaining = Math.max(0, Number(existing.artist_payout || 0) - alreadyPaid);
    if (amount - remaining > 0.005) {
      return NextResponse.json({ error: `Amount exceeds the remaining payout due of ₹${remaining.toFixed(2)}.` }, { status: 400 });
    }

    const extension = extensions[proof.type];
    uploadedPath = `${payoutId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('payout-proofs').upload(
      uploadedPath,
      Buffer.from(await proof.arrayBuffer()),
      { contentType: proof.type, cacheControl: '0', upsert: false }
    );
    if (uploadError) throw uploadError;

    const { data: result, error: recordError } = await supabase.rpc('artiste_record_payout_payment', {
      p_payout_id: payoutId,
      p_amount: amount,
      p_utr: utr,
      p_proof_path: uploadedPath,
    });
    if (recordError) throw recordError;
    paymentRecorded = true;
    const { data: signedData } = await supabase.storage.from('payout-proofs').createSignedUrl(uploadedPath, 60 * 60);
    return NextResponse.json({
      success: true,
      payout: result?.payout || null,
      remainingPending: Number(result?.remaining_pending || 0),
      proofSignedUrl: signedData?.signedUrl || '',
      message: Number(result?.remaining_pending || 0) <= 0 ? 'Payout fully settled. Payment proof saved.' : 'Partial payout recorded. Payment proof saved.',
    });
  } catch (error) {
    if (uploadedPath && !paymentRecorded) {
      try { await supabase.storage.from('payout-proofs').remove([uploadedPath]); } catch {}
    }
    return NextResponse.json({ error: error.message || 'Could not record payout payment.' }, { status: 400 });
  }
}
