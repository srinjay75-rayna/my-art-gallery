"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, LogOut, MapPin, PackageCheck, ShieldCheck, UserRound } from 'lucide-react';
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
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    let subscription;
    try {
      const client = getBrowserSupabase();
      client.auth.getSession().then(({ data }) => {
        if (!active) return;
        const value = data.session || null;
        if (value && (!hasEmailOtpSession(value) || value.user?.user_metadata?.account_type === 'artist')) {
          client.auth.signOut();
          setSession(null);
        } else setSession(value);
        setAuthLoading(false);
      }).catch((err) => { if (active) { setError(err.message); setAuthLoading(false); } });
      const auth = client.auth.onAuthStateChange((_event, value) => {
        if (!active) return;
        if (value && (!hasEmailOtpSession(value) || value.user?.user_metadata?.account_type === 'artist')) {
          setSession(null);
          setTimeout(() => client.auth.signOut(), 0);
        } else setSession(value || null);
        setAuthLoading(false);
      });
      subscription = auth.data.subscription;
    } catch (err) { setError(err.message); setAuthLoading(false); }
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);

  const loadAccount = useCallback(async (current) => {
    if (!current) return;
    setProfileLoading(true);
    setError('');
    try {
      const response = await fetch('/api/account', { headers: { Authorization: `Bearer ${current.access_token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load your Customer account.');
      const meta = current.user?.user_metadata || {};
      const nextProfile = { ...blank, ...(data.profile || {}) };
      nextProfile.full_name ||= meta.full_name || '';
      nextProfile.phone ||= meta.phone || '';
      setProfile(nextProfile);
      setOrders(data.orders || []);
      if (!complete(nextProfile)) {
        router.replace('/account/onboarding');
        return;
      }
      try { if (localStorage.getItem('artiste_pending_cart')) { router.replace('/'); return; } } catch {}
    } catch (err) { setError(err.message); }
    finally { setProfileLoading(false); }
  }, [router]);

  useEffect(() => {
    if (session) loadAccount(session);
    else { setOrders([]); setProfile(blank); }
  }, [session, loadAccount]);

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(profile),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your details.');
      setProfile({ ...blank, ...data.profile });
      setNotice('Your Customer details have been saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await getBrowserSupabase().auth.signOut();
    setSession(null); setOrders([]); setProfile(blank); setNotice('You have been signed out.');
  }

  if (authLoading || (session && profileLoading)) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-10 text-center"><ShieldCheck className="mx-auto text-clay" size={30} /><p className="mt-3 font-display text-2xl">Securing your Customer account…</p></div></main>;

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-6xl">
    <header className="mb-10 flex items-center justify-between"><a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span className="font-display text-2xl">Artiste</span></a><a href="/" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14} /> Gallery</a></header>
    <p className="eyebrow flex items-center gap-2"><UserRound size={14} /> For Cuṣtomers</p><h1 className="mt-2 font-display text-5xl">A home for your <em className="font-normal text-clay">art stories.</em></h1>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {!session ? <div className="mt-8 max-w-2xl"><EmailOtpAuth accountType="customer" redirectBase="/account" /></div> : <>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm text-muted"><ShieldCheck size={15} className="text-green-700" /> Verified Customer <b className="text-ink">{session.user.email}</b></p><button className="action-btn flex items-center gap-2" onClick={logout}><LogOut size={14} /> Sign out</button></div>
      <div className="mt-6 flex flex-wrap gap-2">{['My Orders', 'My Details'].map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === name ? 'bg-ink text-white' : 'border border-[#d9cfc1]'}`}>{name}</button>)}</div>
      {tab === 'My Orders' ? <section className="mt-5 grid gap-4">{orders.map((order) => <article key={order.id} className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{order.merchant_order_ref}</p><h2 className="mt-1 font-display text-2xl">{order.painting_title || `${Array.isArray(order.items) ? order.items.length : 0} artworks`}</h2><p className="mt-1 text-xs text-muted">Placed {new Date(order.created_at).toLocaleString('en-IN')}</p></div><span className="pill">{order.status || 'Pending'}</span></div><div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Total paid</small><p className="mt-1 font-semibold">{money(order.total_amount ?? order.amount_paise / 100)}</p></div><div><small className="eyebrow">Overall shipment status</small><p className="mt-1 font-semibold">{order.shipment_status || 'Processing'}</p></div></div>{order.shipments?.length ? <div className="mt-4 border-t border-[#eee6db] pt-4"><h3 className="flex items-center gap-2 font-display text-xl"><PackageCheck size={18} /> Courier &amp; tracking</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{order.shipments.map((shipment, index) => <div key={`${shipment.shiprocket_shipment_id || shipment.awb_code || index}`} className="rounded-xl bg-[#f7f1e8] p-3 text-xs leading-5"><b>{shipment.courier_name || 'Courier being assigned'}</b><p>Tracking / AWB: <span className="break-all font-semibold">{shipment.awb_code || shipment.shiprocket_shipment_id || 'Awaiting dispatch'}</span></p><p>Shipment status: {shipment.shipment_status || 'Processing'}</p>{shipment.shipment_note && <p className="mt-1 text-muted">{shipment.shipment_note}</p>}</div>)}</div></div> : <div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Courier</small><p className="mt-1 font-semibold">{order.courier_name || 'Being assigned'}</p></div><div><small className="eyebrow">Shiprocket tracking ID</small><p className="mt-1 break-all font-semibold">{order.shiprocket_awb_code || order.shiprocket_shipment_id || 'Awaiting dispatch'}</p></div></div>}{order.shipment_note && <p className="mt-3 text-xs text-muted">Shipping update: {order.shipment_note}</p>}</article>)}{!orders.length && <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-12 text-center"><PackageCheck className="mx-auto text-clay" size={28} /><h2 className="mt-3 font-display text-2xl">No orders yet</h2><p className="mt-2 text-sm text-muted">Your successful Artiste purchases will appear here.</p><a href="/#gallery" className="btn-primary mt-5 inline-flex items-center gap-2">Explore the collection <ArrowUpRight size={15} /></a></div>}</section> : <section className="mt-5 max-w-3xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft"><h2 className="mb-2 flex items-center gap-2 font-display text-3xl"><MapPin size={22} className="text-clay" /> My Details</h2><p className="mb-5 text-xs leading-5 text-muted">These saved details are used at checkout. Your address and order history are private to your account.</p><form onSubmit={save} className="grid gap-4"><IndianAddressForm value={profile} onChange={(patch) => setProfile((current) => ({ ...current, ...patch }))} showContact /><button disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2">{busy ? 'Saving…' : 'Save Customer details'} <ArrowUpRight size={15} /></button></form></section>}
    </>}
    <p className="mt-14 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Customer account</p>
  </div></main>;
}
