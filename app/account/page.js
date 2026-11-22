"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, FileText, LogOut, MapPin, PackageCheck, ShieldCheck, UserRound } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';

const blank = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const complete = (p) => { const digits = String(p?.phone || '').replace(/\D/g, ''); const validPhone = digits.length === 10 || (digits.length === 12 && digits.startsWith('91')); return Boolean(p?.full_name && validPhone && p.address && p.landmark && p.locality && p.city && p.state && /^\d{6}$/.test(String(p.pincode || ''))); };

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [tab, setTab] = useState('My Orders');
  const [profile, setProfile] = useState(blank);
  const [savedProfile, setSavedProfile] = useState(blank);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const verifiedUserRef = useRef(null);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'details') setTab('My Details');
    else if (requestedTab === 'orders') setTab('My Orders');
  }, []);

  useEffect(() => {
    let active = true;
    let subscription;
    const client = getBrowserSupabase();

    const acceptSession = async (value) => {
      if (!active) return;
      if (!value) {
        verifiedUserRef.current = null;
        setSession(null);
        return;
      }
      if (!hasEmailOtpSession(value)) {
        verifiedUserRef.current = null;
        setSession(null);
        setTimeout(() => client.auth.signOut({ scope: 'local' }), 0);
        return;
      }

      // Token refreshes for an already-verified user need no server round trip,
      // but the fresh access token must still reach the page state.
      if (verifiedUserRef.current && verifiedUserRef.current === value.user?.id) {
        setSession(value);
        return;
      }

      try {
        // The server verifies real Customer profile membership instead of
        // trusting Auth metadata that may be stale when the same verified email
        // also owns the other portal's profile.
        const response = await fetch('/api/auth/select-portal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${value.access_token}`,
          },
          body: JSON.stringify({ accountType: 'customer' }),
          cache: 'no-store',
        });
        const result = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          verifiedUserRef.current = null;
          setSession(null);
          setError(result.error || 'This email does not have a Customer profile.');
          // Local scope: a wrong-portal attempt must not sign out other devices.
          setTimeout(() => client.auth.signOut({ scope: 'local' }), 0);
          return;
        }
        verifiedUserRef.current = value.user?.id || null;
        setError('');
        setSession(value);
      } catch (err) {
        if (!active) return;
        verifiedUserRef.current = null;
        setSession(null);
        setError(err.message || 'Could not verify your Customer portal. Please sign in again.');
      }
    };

    try {
      client.auth.getSession().then(async ({ data }) => {
        await acceptSession(data.session || null);
        if (active) setAuthLoading(false);
      }).catch((err) => {
        if (active) {
          setError(err.message);
          setAuthLoading(false);
        }
      });
      const auth = client.auth.onAuthStateChange((event, value) => {
        if (!active) return;
        void acceptSession(value || null);
        if (event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED') setAuthLoading(false);
      });
      subscription = auth.data.subscription;
    } catch (err) {
      setError(err.message);
      setAuthLoading(false);
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const loadAccount = useCallback(async (current) => {
    if (!current) return;
    setProfileLoading(true);
    setError('');
    try {
      const response = await fetch('/api/account', { headers: { Authorization: `Bearer ${current.access_token}` }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load your Customer account.');
      const meta = current.user?.user_metadata || {};
      const nextProfile = { ...blank, ...(data.profile || {}) };
      nextProfile.full_name ||= meta.full_name || '';
      nextProfile.phone ||= meta.phone || '';
      setProfile(nextProfile);
      setSavedProfile(nextProfile);
      setOrders(data.orders || []);
      if (complete(nextProfile)) setEditingAddress(false);
      if (!complete(nextProfile)) {
        router.replace('/account/onboarding');
        return;
      }
      try { if (localStorage.getItem('artiste_pending_cart')) { router.replace('/'); return; } } catch {}
    } catch (err) { setError(err.message); }
    finally { setProfileLoading(false); }
  }, [router]);

  useEffect(() => {
    if (session?.user?.id) loadAccount(session);
    else { setOrders([]); setProfile(blank); setSavedProfile(blank); setEditingAddress(false); }
    // The data refresh is keyed to the user ID, not the rotating access token.
    // This prevents tab focus / TOKEN_REFRESHED events from re-buffering the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, loadAccount]);

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(profile),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save your details.');
      setProfile({ ...blank, ...data.profile });
      setSavedProfile({ ...blank, ...data.profile });
      setEditingAddress(false);
      setNotice('Your Customer details have been saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await getBrowserSupabase().auth.signOut({ scope: 'local' });
    verifiedUserRef.current = null;
    setSession(null); setOrders([]); setProfile(blank); setSavedProfile(blank); setNotice('You have been signed out.');
  }

  if (authLoading) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-10 text-center"><ShieldCheck className="mx-auto text-clay" size={30} /><p className="mt-3 font-display text-2xl">Securing your Customer account…</p></div></main>;

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-6xl">
    <div className="mb-8 flex justify-end"><a href="/#gallery" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14} /> Back to Collection</a></div>
    <p className="eyebrow flex items-center gap-2"><UserRound size={14} /> For Customers</p><h1 className="mt-2 font-display text-5xl">A home for your <em className="font-normal text-clay">art stories.</em></h1>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {!session ? <div className="mt-8 max-w-2xl"><EmailOtpAuth accountType="customer" /></div> : <>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm text-muted"><ShieldCheck size={15} className="text-green-700" /> Verified Customer <b className="text-ink">{session.user.email}</b></p><button className="action-btn flex items-center gap-2" onClick={logout}><LogOut size={14} /> Sign out</button></div>
      {profileLoading && <p className="mt-4 text-xs text-muted">Refreshing your private account details…</p>}
      <div className="mt-6 flex flex-wrap gap-2">{['My Orders', 'My Details'].map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === name ? 'bg-ink text-white' : 'border border-[#d9cfc1]'}`}>{name}</button>)}</div>
      {tab === 'My Orders' ? <section className="mt-5 grid gap-4">{orders.map((order) => <article key={order.id} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{order.merchant_order_ref}</p><h2 className="mt-1 font-display text-2xl">{order.painting_title || `${Array.isArray(order.items) ? order.items.length : 0} artworks`}</h2><p className="mt-1 text-xs text-muted">Placed {new Date(order.created_at).toLocaleString('en-IN')}</p></div><div className="flex flex-wrap items-center gap-2"><span className="pill">{order.status || 'Pending'}</span>{String(order.status || '').toLowerCase() === 'paid' && <a href={`/invoice/${order.id}`} className="action-btn inline-flex items-center gap-1" target="_blank" rel="noreferrer"><FileText size={13}/> View / Download Official Bill (PDF)</a>}</div></div><div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Total paid</small><p className="mt-1 font-semibold">{money(order.total_amount ?? order.amount_paise / 100)}</p></div><div><small className="eyebrow">Overall shipment status</small><p className="mt-1 font-semibold">{order.shipment_status || 'Processing'}</p></div></div>{order.shipments?.length ? <div className="mt-4 border-t border-[#eee6db] pt-4"><h3 className="flex items-center gap-2 font-display text-xl"><PackageCheck size={18} /> Courier &amp; tracking</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{order.shipments.map((shipment, index) => <div key={`${shipment.shiprocket_shipment_id || shipment.awb_code || index}`} className="rounded-xl bg-[#F3ECE1] p-3 text-xs leading-5"><b>{shipment.courier_name || 'Courier being assigned'}</b><p>Tracking / AWB: <span className="break-all font-semibold">{shipment.awb_code || shipment.shiprocket_shipment_id || (/Local delivery|Studio pickup/i.test(shipment.shipment_status || '') ? 'Not applicable — local delivery / studio collection' : 'Awaiting dispatch')}</span></p><p>Shipment status: {shipment.shipment_status || 'Processing'}</p>{shipment.shipment_status === 'Studio pickup selected' && <div className="mt-2 rounded-lg border border-[#D9C6A6] bg-white/70 p-2"><b>Studio collection point</b><p>{[shipment.pickup_contact_name, shipment.pickup_phone, shipment.pickup_address, shipment.pickup_landmark, shipment.pickup_locality, shipment.pickup_city, shipment.pickup_state, shipment.pickup_pincode].filter(Boolean).join(', ')}</p><p className="mt-1">Shiprocket pickup location: {shipment.pickup_location || 'Artist studio'}</p></div>}{shipment.shipment_note && <p className="mt-1 text-muted">{shipment.shipment_note}</p>}</div>)}</div></div> : <div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Courier</small><p className="mt-1 font-semibold">{order.courier_name || 'Being assigned'}</p></div><div><small className="eyebrow">Shiprocket tracking ID</small><p className="mt-1 break-all font-semibold">{order.shiprocket_awb_code || order.shiprocket_shipment_id || 'Awaiting dispatch'}</p></div></div>}{order.shipment_note && <p className="mt-3 text-xs text-muted">Shipping update: {order.shipment_note}</p>}</article>)}{!orders.length && <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-12 text-center"><PackageCheck className="mx-auto text-clay" size={28} /><h2 className="mt-3 font-display text-2xl">No orders yet</h2><p className="mt-2 text-sm text-muted">Your successful Artiste purchases will appear here.</p><a href="/#gallery" className="btn-primary mt-5 inline-flex items-center gap-2">Explore the collection <ArrowUpRight size={15} /></a></div>}</section> : <section id="details" className="mt-5 max-w-3xl rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="mb-2 flex items-center gap-2 font-display text-3xl"><MapPin size={22} className="text-clay"/> My Details</h2><p className="text-xs leading-5 text-muted">Your saved shipping details are used at checkout and remain private to your account.</p></div>{!editingAddress && <button type="button" onClick={() => setEditingAddress(true)} className="btn-secondary">Edit Shipping Address</button>}</div>
        {!editingAddress ? <div className="mt-5 rounded-2xl bg-[#F3ECE1] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{profile.full_name}</p><p className="mt-1 text-xs text-muted">+91 {String(profile.phone || '').replace(/^\+?91/, '')}</p></div><span className="pill">Saved address</span></div><p className="mt-3 text-sm leading-6">{profile.address}</p><p className="mt-1 text-xs text-muted">Landmark: {profile.landmark}</p><p className="mt-1 text-xs text-muted">{[profile.locality, profile.city, profile.state, profile.pincode].filter(Boolean).join(', ')}</p></div> : <form onSubmit={save} className="mt-5 grid gap-4"><IndianAddressForm value={profile} onChange={(patch) => setProfile((current) => ({ ...current, ...patch }))} showContact/><div className="flex flex-wrap gap-2"><button disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2">{busy ? 'Saving…' : 'Save Customer details'} <ArrowUpRight size={15}/></button><button type="button" onClick={() => { setProfile(savedProfile); setEditingAddress(false); }} className="btn-secondary">Cancel</button></div></form>}
      </section>}
    </>}
    <p className="mt-14 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Customer account</p>
  </div></main>;
}
