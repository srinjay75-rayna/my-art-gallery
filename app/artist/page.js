"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Landmark,
  LogOut,
  MapPin,
  Palette,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';

const ArtistPrivateEarnings = dynamic(() => import('@/components/ArtistPrivateEarnings'), { ssr: false, loading: () => null });
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const emptyPickup = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
const artworkBlank = { title: '', medium: '', dimensions: '', price: '', weight_kg: '', length_cm: '', breadth_cm: '', height_cm: '' };
const payoutBlank = { account_holder_name: '', bank_account_number: '', confirm_bank_account_number: '', ifsc_code: '', upi_id: '' };

export default function ArtistPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileChecking, setProfileChecking] = useState(false);
  const [artist, setArtist] = useState(null);
  const [profile, setProfile] = useState({ artist_name: '', bio: '', city: '', state: '', pickup_location: 'Primary' });
  const [pickup, setPickup] = useState(emptyPickup);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('');
  const [payoutForm, setPayoutForm] = useState(payoutBlank);
  const [payoutAccount, setPayoutAccount] = useState(null);
  const [verifiedIfsc, setVerifiedIfsc] = useState(null);
  const [artworks, setArtworks] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [form, setForm] = useState(artworkBlank);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ifscBusy, setIfscBusy] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      const client = getBrowserSupabase();
      const acceptSession = (value) => {
        if (value && (!hasEmailOtpSession(value) || value.user?.user_metadata?.account_type === 'customer')) {
          setSession(null);
          setTimeout(() => client.auth.signOut(), 0);
          return;
        }
        setSession(value || null);
      };
      client.auth.getSession().then(({ data }) => {
        acceptSession(data.session || null);
        setAuthLoading(false);
      }).catch((err) => {
        setError(err.message || 'Could not restore your Artist session.');
        setAuthLoading(false);
      });
      const { data: { subscription } } = client.auth.onAuthStateChange((event, value) => {
        // Refreshing a token is not a new page load. Keep the current portal
        // mounted and update only the access token/session object.
        acceptSession(value || null);
        if (event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED') setAuthLoading(false);
      });
      return () => subscription.unsubscribe();
    } catch (err) {
      setError(err.message);
      setAuthLoading(false);
    }
  }, []);

  const authHeaders = () => ({ Authorization: `Bearer ${session?.access_token || ''}` });
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function load(showInlineLoading = false) {
    if (!session) return;
    if (showInlineLoading) setProfileChecking(true);
    try {
      const data = await api('/api/artist/profile');
      setArtist(data.artist || null);
      setLedger(data.ledger || []);
      const complete = Boolean(
        data.artist?.artist_name && data.artist?.bio && data.artist?.pickup_address &&
        data.artist?.pickup_phone && data.artist?.pickup_landmark && data.artist?.pickup_locality &&
        data.artist?.city && data.artist?.state && /^\d{6}$/.test(String(data.artist?.pickup_pincode || '')) &&
        data.payoutAccount?.verified_at
      );
      if (!complete) {
        router.replace('/artist/onboarding');
        return;
      }

      setEditingDetails(false);
      setEditingPayout(false);
      setPayoutAccount(data.payoutAccount || null);
      if (data.payoutAccount) {
        setPayoutForm({
          ...payoutBlank,
          account_holder_name: data.payoutAccount.account_holder_name || '',
          ifsc_code: data.payoutAccount.ifsc_code || '',
          upi_id: data.payoutAccount.upi_id || '',
        });
        setVerifiedIfsc({ bank_name: data.payoutAccount.bank_name, branch_name: data.payoutAccount.branch_name, ifsc: data.payoutAccount.ifsc_code });
      }
      if (data.artist) {
        const a = data.artist;
        setProfile({ artist_name: a.artist_name || '', bio: a.bio || '', city: a.city || '', state: a.state || '', pickup_location: a.pickup_location || 'Primary' });
        setPickup({
          full_name: a.pickup_contact_name || a.artist_name || '',
          phone: a.pickup_phone || '',
          address: a.pickup_address || '',
          landmark: a.pickup_landmark || '',
          locality: a.pickup_locality || '',
          city: a.city || '',
          state: a.state || '',
          pincode: a.pickup_pincode || '',
        });
        const paintings = await api('/api/artist/paintings');
        setArtworks(paintings.paintings || []);
      }
    } finally {
      if (showInlineLoading) setProfileChecking(false);
    }
  }

  // Key the data load to the authenticated user ID, not the rotating token.
  // TOKEN_REFRESHED / focus events therefore never re-buffer the portal.
  useEffect(() => {
    if (session?.user?.id) load(true).catch((err) => setError(err.message));
    else {
      setArtist(null);
      setArtworks([]);
      setLedger([]);
      setPayoutAccount(null);
      setPayoutForm(payoutBlank);
      setVerifiedIfsc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, router]);

  useEffect(() => {
    if (!profilePhoto) {
      setProfilePhotoPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(profilePhoto);
    setProfilePhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const data = new FormData();
      Object.entries(profile).forEach(([key, value]) => data.append(key, value));
      data.append('pickup_address', pickup.address);
      data.append('pickup_contact_name', pickup.full_name);
      data.append('pickup_phone', pickup.phone);
      data.append('pickup_landmark', pickup.landmark);
      data.append('pickup_locality', pickup.locality);
      data.append('pickup_pincode', pickup.pincode);
      if (profilePhoto) data.append('photo', profilePhoto);
      const result = await api('/api/artist/profile', { method: 'POST', body: data });
      setArtist(result.artist);
      setProfilePhoto(null);
      setNotice(result.message);
      await load(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function verifyIFSC() {
    const ifsc = payoutForm.ifsc_code.trim().toUpperCase();
    setIfscBusy(true); setError(''); setVerifiedIfsc(null);
    try {
      const result = await api(`/api/artist/verify-ifsc?ifsc=${encodeURIComponent(ifsc)}`);
      setVerifiedIfsc(result);
      setPayoutForm((current) => ({ ...current, ifsc_code: result.ifsc }));
      setNotice(`Verified: ${result.bank_name}, ${result.branch_name}.`);
    } catch (err) { setError(err.message); }
    finally { setIfscBusy(false); }
  }

  async function savePayout(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/artist/payout-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payoutForm),
      });
      setPayoutAccount(result.account);
      setPayoutForm((current) => ({ ...payoutBlank, account_holder_name: current.account_holder_name, ifsc_code: current.ifsc_code, upi_id: current.upi_id }));
      setVerifiedIfsc({ ifsc: result.account.ifsc_code, bank_name: result.account.bank_name, branch_name: result.account.branch_name });
      setNotice(result.message);
      await load(false);
      setEditingPayout(false);
      setEditingDetails(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function uploadArtwork(event) {
    event.preventDefault();
    if (!photo) { setError('Choose an artwork photo.'); return; }
    if (!payoutAccount?.verified_at) { setError('Complete and verify your bank payout details before listing an artwork.'); return; }
    if (artist?.is_suspended) { setError('Your Artist account is suspended. Please contact Artiste support.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, value));
      data.append('photo', photo);
      const result = await api('/api/artist/paintings', { method: 'POST', body: data });
      setNotice(result.message);
      setForm(artworkBlank); setPhoto(null);
      const photoInput = document.getElementById('artist-painting-photo');
      if (photoInput) photoInput.value = '';
      await load(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function toggleSold(painting) {
    setBusy(true);
    try {
      await api(`/api/artist/paintings/${painting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_sold: !painting.is_sold }),
      });
      await load(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove(painting) {
    if (!confirm(`Delete “${painting.title}”?`)) return;
    setBusy(true);
    try {
      await api(`/api/artist/paintings/${painting.id}`, { method: 'DELETE' });
      await load(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await getBrowserSupabase().auth.signOut();
    setArtist(null);
    setNotice('You have been signed out.');
  }

  const avatarUrl = profilePhotoPreview || artist?.avatar_url || artist?.profile_photo_url || '';
  const addressLine = [artist?.pickup_address, artist?.pickup_landmark, artist?.pickup_locality, artist?.city, artist?.state, artist?.pickup_pincode].filter(Boolean).join(', ');
  const isSuspended = Boolean(artist?.is_suspended);

  if (authLoading) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-10 text-center"><ShieldCheck size={28} className="mx-auto text-clay"/><h1 className="mt-3 font-display text-2xl">Securing your Artist Portal…</h1></div></main>;

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-6xl">
    <header className="mb-9 flex items-center justify-between"><a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span className="font-display text-2xl">Artiste</span></a><a href="/" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14}/> Gallery</a></header>
    <p className="eyebrow flex items-center gap-2"><Palette size={14}/> For Artiṣte · Independent Artist programme</p>
    <div className="mt-3 flex flex-wrap items-center gap-4">
      {session && <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-[#e9d8c4] bg-[#f1e8dc] shadow-soft">{avatarUrl ? <img src={avatarUrl} alt={`${artist?.artist_name || 'Artist'} profile`} className="h-full w-full rounded-full object-cover"/> : <span className="font-display text-3xl text-clay">A</span>}</div>}
      <div><h1 className="max-w-3xl font-display text-5xl leading-tight md:text-6xl">Your work deserves <em className="font-normal text-clay">its own room.</em></h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Create your Artist profile, publish original work and manage your Artiste collection.</p></div>
    </div>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

    {!session ? <div className="mt-8 max-w-xl"><EmailOtpAuth accountType="artist"/></div> : <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Verified Artist account <b className="text-ink">{session.user.email}</b></p><button onClick={logout} className="action-btn inline-flex items-center gap-2"><LogOut size={14}/> Sign out</button></div>
      {profileChecking && !artist && <div className="mt-5 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5 text-sm text-muted">Loading your Artist studio…</div>}
      {artist && <>
        {isSuspended && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>Your Artist studio is currently suspended.</b><p className="mt-1 text-xs leading-5">Your existing records remain safe, but you cannot publish or sell artworks while the studio is suspended. Please contact Artiste support for assistance.</p></div>}

        <div className="mt-7 grid items-start gap-7 lg:grid-cols-[.9fr_1.1fr]">
          <section className="rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft md:p-7">
            <p className="eyebrow flex items-center gap-2"><Palette size={13}/> Artist studio</p>
            <h2 className="mt-2 font-display text-3xl">List an Artwork</h2>
            <p className="mt-2 text-xs leading-5 text-muted">Your verified Artist studio is ready to publish original work directly to the Artiste gallery.</p>
            {isSuspended && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800">Publishing is disabled while your account is suspended.</p>}
            <form onSubmit={uploadArtwork} className="mt-5 grid gap-3">
              <label className="label">Artwork photo<input id="artist-painting-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="mt-2 block w-full text-xs"/></label>
              {[
                ['title', 'Title'], ['medium', 'Medium'], ['dimensions', 'Canvas size'],
                ['price', 'Price (INR)'], ['weight_kg', 'Packed weight (kg)'],
              ].map(([name, label]) => <label className="label" key={name}>{label}<input className="field mt-1" value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} required type={['price', 'weight_kg'].includes(name) ? 'number' : 'text'} step={['price', 'weight_kg'].includes(name) ? '0.01' : undefined} min={['price', 'weight_kg'].includes(name) ? '0.01' : undefined}/></label>)}
              <div className="grid grid-cols-3 gap-2">{['length_cm', 'breadth_cm', 'height_cm'].map((name) => <label key={name} className="label">{name.replace('_cm', '')} cm<input className="field mt-1" type="number" min="0.1" step="0.1" required value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })}/></label>)}</div>
              <button disabled={busy || isSuspended || !payoutAccount?.verified_at} className="btn-primary inline-flex items-center justify-center gap-2">{busy ? 'Publishing…' : isSuspended ? 'Studio suspended' : 'Publish Artwork'} <ArrowUpRight size={15}/></button>
            </form>
          </section>

          <section className="min-w-0">
            <div className="rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft md:p-7">
              <p className="eyebrow flex items-center gap-2"><Wallet size={13}/> Artist workspace</p>
              <h2 className="mt-2 font-display text-3xl">My Paintings &amp; Earnings</h2>
              <div className="mt-5 grid gap-3">{artworks.map((painting) => <article key={painting.id} className="flex gap-3 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-3">
                <img src={painting.image_url} alt={painting.title} className="h-24 w-20 rounded-xl object-cover"/>
                <div className="min-w-0 flex-1"><h3 className="font-display text-xl">{painting.title}</h3><p className="text-xs text-muted">{money(painting.price)} · {painting.is_sold ? 'Sold' : painting.is_approved ? 'Published' : 'Unpublished by Artiste'}</p><div className="mt-2 flex flex-wrap gap-2">{!painting.is_sold && <button className="action-btn" disabled={busy || isSuspended} onClick={() => toggleSold(painting)}>Mark sold</button>}<button className="action-btn danger" disabled={busy || painting.is_sold} onClick={() => remove(painting)}>Delete</button></div></div>
              </article>)}{!artworks.length && <p className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted">Your published paintings will appear here.</p>}</div>
            </div>
            <ArtistPrivateEarnings ledger={ledger} showLedger/>
          </section>
        </div>

        <section className="mt-8 rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow flex items-center gap-2"><BadgeCheck size={13}/> Studio &amp; payout profile</p><h2 className="mt-2 font-display text-3xl">Your saved Artist details</h2><p className="mt-1 text-xs leading-5 text-muted">Your studio pickup address and verified payout destination are kept private.</p></div><button type="button" onClick={() => { setEditingDetails((value) => !value); setEditingPayout(!editingDetails && Boolean(payoutAccount?.verified_at)); }} className="btn-secondary">{editingDetails ? 'Close editor' : 'Edit Studio & Bank Details'}</button></div>
          {!editingDetails ? <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-[#f7f1e8] p-4"><div className="flex items-center gap-2 font-semibold"><MapPin size={16} className="text-clay"/> Studio pickup</div><p className="mt-2 text-sm font-semibold">{artist.artist_name}</p><p className="mt-1 text-xs leading-6 text-muted">{addressLine || 'Pickup address not saved'}</p><p className="mt-1 text-xs text-muted">{artist.pickup_contact_name} · {artist.pickup_phone}</p><p className="mt-1 text-[10px] text-muted">Shiprocket location: {artist.pickup_location || 'Primary'}</p></div>
            <div className="rounded-2xl bg-[#f7f1e8] p-4"><div className="flex items-center gap-2 font-semibold"><Landmark size={16} className="text-clay"/> Verified bank / UPI</div>{payoutAccount?.verified_at ? <><p className="mt-2 text-sm font-semibold">{payoutAccount.bank_name} · {payoutAccount.branch_name}</p><p className="mt-1 text-xs leading-6 text-muted">{payoutAccount.account_holder_name} · {payoutAccount.bank_account_number_masked} · {payoutAccount.ifsc_code}</p><p className="mt-1 text-xs text-muted">{payoutAccount.upi_id ? `UPI: ${payoutAccount.upi_id}` : 'No UPI ID saved'}</p></> : <p className="mt-2 text-xs text-muted">Payout details not verified.</p>}</div>
          </div> : <div className="mt-5 grid gap-5">
            <form onSubmit={saveProfile} className="rounded-2xl border border-[#eee6db] p-5">
              <h3 className="font-display text-2xl">Artist profile &amp; studio pickup</h3>
              <div className="mt-4 flex flex-wrap items-center gap-4"><label className="group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-4 border-[#eadbca] bg-[#f5eadc] shadow-soft">{avatarUrl ? <img src={avatarUrl} alt="Artist profile preview" className="h-full w-full object-cover"/> : <span className="font-display text-3xl text-clay">A</span>}<span className="absolute inset-x-0 bottom-0 bg-ink/75 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white">Change photo</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setProfilePhoto(e.target.files?.[0] || null)} className="sr-only"/></label><div><p className="font-semibold">Circular Artist profile photo</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted">Upload a JPG, PNG, WEBP or AVIF image up to 6 MB. It appears beside your Artist name in the public gallery.</p>{profilePhoto && <p className="mt-1 text-xs text-green-700">New photo selected. Save your Artist profile to publish it.</p>}</div></div>
              <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="label">Artist name<input className="field mt-1" value={profile.artist_name} onChange={(e) => setProfile({ ...profile, artist_name: e.target.value })} required maxLength={100}/></label><label className="label">Verified email<input className="field mt-1" value={session.user.email || ''} readOnly/></label><label className="label md:col-span-2">Artist bio<textarea className="field mt-1 min-h-24" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} required maxLength={1200} placeholder="Tell collectors about your practice…"/></label></div>
              <div className="mt-5 border-t border-[#eee6db] pt-5"><h4 className="font-display text-xl">Artist pickup address</h4><div className="mt-3"><IndianAddressForm value={pickup} onChange={(patch) => { setPickup((current) => ({ ...current, ...patch })); setProfile((current) => ({ ...current, ...(patch.city ? { city: patch.city } : {}), ...(patch.state ? { state: patch.state } : {}) })); }} showContact addressLabel="Full pickup street address"/></div><label className="label mt-4 block">Shiprocket pickup location name<input className="field mt-1" value={profile.pickup_location} onChange={(e) => setProfile({ ...profile, pickup_location: e.target.value })} required placeholder="Exact location name in Shiprocket"/></label></div>
              <button disabled={busy} className="btn-primary mt-5 inline-flex items-center gap-2">{busy ? 'Saving studio…' : 'Save Studio Profile'} <ArrowUpRight size={15}/></button>
            </form>

            <section className="rounded-2xl border border-[#eee6db] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-2xl">Verified bank &amp; UPI payout details</h3><p className="mt-1 text-xs leading-5 text-muted">Bank account numbers are encrypted before storage. Only a masked number is shown here.</p></div>{payoutAccount?.verified_at && <span className="pill">IFSC verified</span>}</div>
              {payoutAccount?.verified_at && !editingPayout && <div className="mt-4 rounded-xl bg-[#f4e8d9] p-4 text-sm"><b>{payoutAccount.bank_name}</b> · {payoutAccount.branch_name}<p className="mt-1 text-xs text-muted">{payoutAccount.account_holder_name} · {payoutAccount.bank_account_number_masked} · {payoutAccount.ifsc_code}{payoutAccount.upi_id ? ` · UPI: ${payoutAccount.upi_id}` : ''}</p><button type="button" onClick={() => setEditingPayout(true)} className="mt-3 text-xs font-bold text-clay underline">Update bank / UPI details</button></div>}
              {(!payoutAccount?.verified_at || editingPayout) && <form onSubmit={savePayout} className="mt-4 grid gap-4 md:grid-cols-2"><label className="label">Account holder name<input className="field mt-1" required maxLength={120} value={payoutForm.account_holder_name} onChange={(e) => setPayoutForm({ ...payoutForm, account_holder_name: e.target.value })}/></label><label className="label">UPI ID <span className="normal-case tracking-normal text-muted">(optional)</span><input className="field mt-1" placeholder="name@bank" value={payoutForm.upi_id} onChange={(e) => setPayoutForm({ ...payoutForm, upi_id: e.target.value })}/></label><label className="label">Bank account number<input className="field mt-1" type="password" inputMode="numeric" autoComplete="off" required pattern="[0-9]{8,20}" value={payoutForm.bank_account_number} onChange={(e) => setPayoutForm({ ...payoutForm, bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 20) })}/></label><label className="label">Confirm bank account number<input className="field mt-1" type="password" inputMode="numeric" autoComplete="off" required pattern="[0-9]{8,20}" value={payoutForm.confirm_bank_account_number} onChange={(e) => setPayoutForm({ ...payoutForm, confirm_bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 20) })}/></label><div><label className="label">11-character IFSC code<input className="field mt-1 uppercase" maxLength={11} required value={payoutForm.ifsc_code} onChange={(e) => { setPayoutForm({ ...payoutForm, ifsc_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) }); setVerifiedIfsc(null); }}/></label><button type="button" onClick={verifyIFSC} disabled={ifscBusy || payoutForm.ifsc_code.length !== 11} className="btn-secondary mt-2 w-full">{ifscBusy ? 'Verifying…' : 'Verify IFSC'}</button></div>
                {verifiedIfsc && <div className="md:col-span-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900"><b>Verified bank:</b> {verifiedIfsc.bank_name} · {verifiedIfsc.branch_name}<p className="mt-1 text-xs">IFSC {verifiedIfsc.ifsc}</p></div>}
                <div className="flex flex-wrap gap-2 md:col-span-2"><button disabled={busy || !verifiedIfsc} className="btn-primary inline-flex items-center gap-2">{busy ? 'Saving securely…' : 'Save verified payout details'} <ArrowUpRight size={15}/></button>{editingPayout && <button type="button" className="btn-secondary" onClick={() => setEditingPayout(false)}>Cancel payout edit</button>}</div>
              </form>}
            </section>
          </div>}
        </section>
      </>}
    </>}
    <p className="mt-14 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Independent Artist portal</p>
  </div></main>;
}
