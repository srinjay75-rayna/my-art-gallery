"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, BadgeCheck, Banknote, CheckCircle2, Landmark, MapPin, ShieldCheck, UserRoundPlus, Wallet } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import { normaliseIndianPhone } from '@/lib/india-address';
import IndianAddressForm from '@/components/IndianAddressForm';

const emptyAddress = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
const payoutBlank = { account_holder_name: '', bank_account_number: '', confirm_bank_account_number: '', ifsc_code: '', upi_id: '' };
const completeArtist = (a) => Boolean(a?.artist_name && a?.bio && a?.pickup_address && a?.pickup_phone && a?.pickup_landmark && a?.pickup_locality && a?.city && a?.state && /^\d{6}$/.test(String(a?.pickup_pincode || '')));

function readStoredArtistPhone() {
  if (typeof window === 'undefined') return '';
  const keys = ['artiste_artist_phone', 'artiste_artist_signup', 'artiste_signup_artist', 'artiste_signup_data', 'artiste_phone', 'artist_phone', 'phone'];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let candidate = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') candidate = parsed.phone || parsed.mobile || parsed.mobile_number || parsed.user?.phone || '';
      } catch {}
      const digits = normaliseIndianPhone(candidate);
      if (digits) return digits;
    } catch {}
  }
  return '';
}

function storeArtistPhone(value) {
  try { window.localStorage.setItem('artiste_artist_phone', normaliseIndianPhone(value)); } catch {}
}

export default function ArtistOnboardingPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [artist, setArtist] = useState(null);
  const [artistName, setArtistName] = useState('');
  const [creatorRole, setCreatorRole] = useState('Painter');
  const [bio, setBio] = useState('');
  const [pickupLocation, setPickupLocation] = useState('Primary');
  const [address, setAddress] = useState(emptyAddress);
  const [photo, setPhoto] = useState(null);
  const [payout, setPayout] = useState(payoutBlank);
  const [payoutReady, setPayoutReady] = useState(false);
  const [verifiedIfsc, setVerifiedIfsc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ifscBusy, setIfscBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const phoneDigits = useMemo(() => normaliseIndianPhone(address.phone), [address.phone]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      try {
        const client = getBrowserSupabase();
        const { data } = await client.auth.getSession();
        const current = data.session;
        if (!current || !hasEmailOtpSession(current) || !current.user?.email_confirmed_at) {
          router.replace('/artist');
          return;
        }
        const metadata = current.user.user_metadata || {};
        if (metadata.account_type && metadata.account_type !== 'artist') {
          await client.auth.signOut();
          router.replace('/artist');
          return;
        }
        if (!active) return;
        setSession(current);
        const response = await fetch('/api/artist/profile', { headers: { Authorization: `Bearer ${current.access_token}` }, cache: 'no-store' });
        const dataResult = await response.json();
        if (!response.ok) throw new Error(dataResult.error || 'Could not load your Artist profile.');
        const a = dataResult.artist || null;
        setArtist(a);
        setArtistName(a?.artist_name || metadata.artist_name || metadata.full_name || '');
        setCreatorRole(a?.creator_role === 'Photographer' ? 'Photographer' : 'Painter');
        setBio(a?.bio || '');
        setPickupLocation(a?.pickup_location || 'Primary');
        setAddress({
          ...emptyAddress,
          full_name: a?.pickup_contact_name || a?.artist_name || metadata.artist_name || '',
          phone: normaliseIndianPhone(a?.pickup_phone || metadata.phone || readStoredArtistPhone()),
          address: a?.pickup_address || '', landmark: a?.pickup_landmark || '', locality: a?.pickup_locality || '',
          city: a?.city || '', state: a?.state || '', pincode: a?.pickup_pincode || '',
        });
        const initialPhone = normaliseIndianPhone(a?.pickup_phone || metadata.phone || readStoredArtistPhone());
        if (initialPhone) storeArtistPhone(initialPhone);
        if (dataResult.payoutAccount?.verified_at) {
          setPayoutReady(true);
          setPayout((currentPayout) => ({ ...currentPayout, account_holder_name: dataResult.payoutAccount.account_holder_name || '', ifsc_code: dataResult.payoutAccount.ifsc_code || '', upi_id: dataResult.payoutAccount.upi_id || '' }));
          setVerifiedIfsc({ ifsc: dataResult.payoutAccount.ifsc_code, bank_name: dataResult.payoutAccount.bank_name, branch_name: dataResult.payoutAccount.branch_name });
        }
        if (completeArtist(a) && dataResult.payoutAccount?.verified_at) router.replace('/artist');
      } catch (err) { if (active) setError(err.message || 'Could not load Artist onboarding.'); }
      finally { if (active) setLoading(false); }
    }
    initialise();
    return () => { active = false; };
  }, [router]);

  async function verifyIFSC() {
    const ifsc = payout.ifsc_code.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { setError('Enter a valid 11-character IFSC code.'); return; }
    setIfscBusy(true); setError(''); setNotice(''); setVerifiedIfsc(null);
    try {
      const response = await fetch(`/api/artist/verify-ifsc?ifsc=${encodeURIComponent(ifsc)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not verify IFSC.');
      setVerifiedIfsc(data);
      setPayout((current) => ({ ...current, ifsc_code: data.ifsc }));
      setNotice(`IFSC verified: ${data.bank_name}, ${data.branch_name}.`);
    } catch (err) { setError(err.message); }
    finally { setIfscBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (!session) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!payoutReady && !verifiedIfsc) throw new Error('Verify your IFSC code before saving payout details.');
      if (!payoutReady && payout.bank_account_number !== payout.confirm_bank_account_number) throw new Error('Bank account number and confirmation do not match.');
      if (!/^\d{10}$/.test(phoneDigits)) throw new Error('Enter or confirm your 10-digit Indian mobile number for studio pickup.');

      const form = new FormData();
      form.set('artist_name', artistName.trim());
      form.set('creator_role', creatorRole);
      form.set('bio', bio.trim());
      form.set('city', address.city.trim());
      form.set('state', address.state.trim());
      form.set('pickup_address', address.address.trim());
      form.set('pickup_contact_name', artistName.trim());
      form.set('pickup_phone', phoneDigits);
      storeArtistPhone(phoneDigits);
      form.set('pickup_landmark', address.landmark.trim());
      form.set('pickup_locality', address.locality.trim());
      form.set('pickup_pincode', address.pincode.trim());
      form.set('pickup_location', pickupLocation.trim());
      if (photo) form.set('photo', photo);
      const profileResponse = await fetch('/api/artist/profile', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const profileData = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileData.error || 'Could not save Artist profile.');
      setArtist(profileData.artist);

      if (!payoutReady) {
        const payoutResponse = await fetch('/api/artist/payout-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(payout),
        });
        const payoutData = await payoutResponse.json();
        if (!payoutResponse.ok) throw new Error(payoutData.error || 'Could not save payout details.');
      }
      router.replace('/artist');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-10 text-center"><ShieldCheck size={28} className="mx-auto text-clay" /><h1 className="mt-3 font-display text-2xl">Verifying your Artist access…</h1></div></main>;

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-4xl">
    <div className="mb-8 flex justify-end"><a href="/artist" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14} /> Creator Portal</a></div>
    <p className="eyebrow flex items-center gap-2"><BadgeCheck size={14} /> Email verified · Step 2 of 2</p>
    <h1 className="mt-3 font-display text-5xl">Set up your <em className="font-normal text-clay">Creator studio.</em></h1>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Choose Painter or Photographer, then complete your creator profile, studio pickup details and IFSC-verified payout destination. Once saved, your Creator studio activates automatically and you can publish original work immediately.</p>
    <div className="mt-6 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-4 text-sm"><p className="font-semibold">{artistName || 'Artist'} · {session?.user?.email}</p><p className="mt-1 text-xs text-muted">+91 {phoneDigits} · Studio &amp; payout information stays private.</p></div>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-5 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <form onSubmit={save} className="mt-6 grid gap-6">
      <section className="rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft">
        <h2 className="flex items-center gap-2 font-display text-2xl"><UserRoundPlus size={20} className="text-clay" /> Artist Profile</h2>
        <div className="mt-4 grid gap-4"><label className="label">Creator Role<select className="field mt-1" value={creatorRole} onChange={(e) => setCreatorRole(e.target.value)}><option value="Painter">Painter (displayed as Artist)</option><option value="Photographer">Photographer</option></select></label><label className="label">Creator / Studio Name<input className="field mt-1" required minLength={2} maxLength={100} value={artistName} onChange={(e) => setArtistName(e.target.value)} /></label><label className="label">Artist Biography<textarea className="field mt-1 min-h-28" required maxLength={1200} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell collectors about your practice, inspirations and medium." /></label><label className="label flex items-center gap-2">Portfolio / Profile Photo <span className="text-[10px] font-normal text-muted">(optional)</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="mt-2 block w-full text-xs" /></label></div>
      </section>
      <section className="rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft">
        <h2 className="flex items-center gap-2 font-display text-2xl"><MapPin size={20} className="text-clay" /> Studio Pickup Address</h2>
        <p className="mt-2 text-xs leading-6 text-muted">Shiprocket uses this studio address as the shipping origin for your artworks. Keep the registered pickup-location name accurate.</p>
        <label className="label mt-4 block">+91 Mobile Number for Studio Pickup<div className="mt-1 flex items-center rounded-xl border border-[#D9C6A6] bg-[#FAF6F0] px-3"><span className="mr-2 text-sm text-muted">+91</span><input className="w-full bg-transparent py-3 text-sm outline-none" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[0-9]{10}" maxLength={10} value={phoneDigits} onChange={(e) => { const digits = e.target.value.replace(/\D/g, '').slice(-10); setAddress((current) => ({ ...current, phone: digits })); storeArtistPhone(digits); }} placeholder="10-digit mobile number" /></div><span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">Confirm or enter the mobile number the courier can use for studio pickup.</span></label>
        <div className="mt-4"><IndianAddressForm value={address} onChange={(patch) => setAddress((current) => ({ ...current, ...patch }))} showContact={false} addressLabel="Studio pickup street address" /></div>
        <label className="label mt-4 block">Shiprocket registered pickup-location name<input className="field mt-1" required value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="Exact pickup location name in Shiprocket" /></label>
        <p className="mt-2 text-[10px] leading-5 text-muted">This name must exactly match a pickup location already configured in your Shiprocket account. Example: ArtistStudio-Kolkata.</p>
      </section>
      <section className="rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft">
        <h2 className="flex items-center gap-2 font-display text-2xl"><Landmark size={20} className="text-clay" /> Verified Payout Details</h2>
        {payoutReady ? <div className="mt-4 flex items-start gap-3 rounded-2xl bg-green-50 p-4 text-sm text-green-900"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><div><b>Your payout account is already verified.</b><p className="mt-1 text-xs leading-5">{payout.account_holder_name} · {payout.ifsc_code} · {verifiedIfsc?.bank_name} / {verifiedIfsc?.branch_name}</p></div></div> : <>
          <p className="mt-2 text-xs leading-6 text-muted">Bank account numbers are encrypted before storage. Verify your IFSC to confirm the bank and branch before saving.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="label sm:col-span-2">Account Holder Name<input className="field mt-1" required value={payout.account_holder_name} onChange={(e) => setPayout({ ...payout, account_holder_name: e.target.value })} /></label>
            <label className="label">Bank Account Number<input className="field mt-1" required inputMode="numeric" autoComplete="off" value={payout.bank_account_number} onChange={(e) => setPayout({ ...payout, bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
            <label className="label">Confirm Bank Account Number<input className="field mt-1" required inputMode="numeric" autoComplete="off" value={payout.confirm_bank_account_number} onChange={(e) => setPayout({ ...payout, confirm_bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
            <div className="sm:col-span-2"><label className="label">11-character IFSC Code<input className="field mt-1 uppercase" required maxLength={11} value={payout.ifsc_code} onChange={(e) => { setPayout({ ...payout, ifsc_code: e.target.value.toUpperCase().slice(0, 11) }); setVerifiedIfsc(null); }} placeholder="SBIN0000001" /></label><button type="button" onClick={verifyIFSC} disabled={ifscBusy} className="btn-secondary mt-2 inline-flex items-center gap-2">{ifscBusy ? 'Verifying IFSC…' : 'Verify bank & branch'} <ShieldCheck size={15} /></button></div>
            {verifiedIfsc && <div className="sm:col-span-2 rounded-xl bg-green-50 p-3 text-sm text-green-900"><b>{verifiedIfsc.bank_name}</b><p className="mt-1 text-xs">{verifiedIfsc.branch_name} · IFSC {verifiedIfsc.ifsc}</p></div>}
            <label className="label sm:col-span-2">Optional UPI ID<input className="field mt-1" value={payout.upi_id} onChange={(e) => setPayout({ ...payout, upi_id: e.target.value })} placeholder="name@bank" /></label>
          </div>
        </>}
      </section>
      <button disabled={busy} className="btn-primary flex items-center justify-center gap-2">{busy ? 'Saving your Artist profile…' : 'Save profile & continue to Creator Portal'} <ArrowUpRight size={15} /></button>
      <p className="text-center text-[10px] leading-5 text-muted">Your Creator studio activates automatically after your profile and verified payout details are saved. Your payout and pickup information remains private.</p>
    </form>
  </div></main>;
}

