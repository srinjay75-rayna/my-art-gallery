"use client";
import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';
const blank = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
export default function AccountPage() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('My Orders');
  const [profile, setProfile] = useState(blank);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      const client = getBrowserSupabase();
      const acceptSession = (value) => {
        if (value && !hasEmailOtpSession(value)) { setSession(null); setTimeout(() => client.auth.signOut(), 0); return; }
        setSession(value || null);
      };
      client.auth.getSession().then(({ data }) => acceptSession(data.session || null));
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, value) => acceptSession(value));
      return () => subscription.unsubscribe();
    } catch (err) { setError(err.message); }
  }, []);
  async function load(current = session) {
    if (!current) return;
    const response = await fetch('/api/account', { headers: { Authorization: `Bearer ${current.access_token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load Customer account.');
    setProfile({ ...blank, ...(data.profile || {}) }); setOrders(data.orders || []);
  }
  useEffect(() => { if (session) load(session).catch((err) => setError(err.message)); else { setOrders([]); setProfile(blank); } }, [session]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(profile) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save details.');
      setProfile({ ...blank, ...data.profile }); setNotice('Your Customer details have been saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function logout() { await getBrowserSupabase().auth.signOut(); setSession(null); setOrders([]); setProfile(blank); setNotice('You have been signed out.'); }
  function updateProfile(patch) { setProfile((current) => ({ ...current, ...patch })); }

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-6xl">
    <header className="mb-10 flex items-center justify-between"><a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span className="font-display text-2xl">Artiste</span></a><a href="/" className="text-xs font-bold uppercase tracking-wider text-clay">← Continue shopping</a></header>
    <p className="eyebrow">For Customers <span className="cedilla-mark">¸</span></p><h1 className="mt-2 font-display text-5xl">A home for your <em className="font-normal text-clay">art stories.</em></h1>
    {error && <p className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {!session ? <div className="mt-8 max-w-xl"><EmailOtpAuth accountType="customer" onVerified={(value) => { setSession(value); setNotice('Your email is verified. Complete My Details before checkout.'); }} /></div> : <>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Verified Customer <b className="text-ink">{session.user.email}</b></p><button className="action-btn" onClick={logout}>Sign out</button></div>
      <div className="mt-6 flex gap-2">{['My Orders', 'My Details'].map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === name ? 'bg-ink text-white' : 'border border-[#d9cfc1]'}`}>{name}</button>)}</div>
      {tab === 'My Orders' ? <section className="mt-5 grid gap-4">{orders.map((order) => <article key={order.id} className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{order.merchant_order_ref}</p><h2 className="mt-1 font-display text-2xl">{order.painting_title || `${Array.isArray(order.items) ? order.items.length : 0} artworks`}</h2><p className="mt-1 text-xs text-muted">Placed {new Date(order.created_at).toLocaleString('en-IN')}</p></div><span className="pill">{order.status || 'Pending'}</span></div><div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Total paid</small><p className="mt-1 font-semibold">{money(order.total_amount ?? order.amount_paise / 100)}</p></div><div><small className="eyebrow">Overall shipment status</small><p className="mt-1 font-semibold">{order.shipment_status || 'Processing'}</p></div></div>{order.shipments?.length ? <div className="mt-4 border-t border-[#eee6db] pt-4"><h3 className="font-display text-xl">Courier &amp; tracking</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{order.shipments.map((shipment) => <div key={shipment.id} className="rounded-xl bg-[#f7f1e8] p-3 text-xs leading-5"><b>{shipment.courier_name || 'Courier being assigned'}</b><p>Tracking / AWB: <span className="break-all font-semibold">{shipment.awb_code || shipment.shiprocket_shipment_id || 'Awaiting dispatch'}</span></p><p>Shipment status: {shipment.shipment_status || 'Processing'}</p>{shipment.shipment_note && <p className="mt-1 text-muted">{shipment.shipment_note}</p>}</div>)}</div></div> : <div className="mt-4 grid gap-3 border-t border-[#eee6db] pt-4 sm:grid-cols-2"><div><small className="eyebrow">Courier</small><p className="mt-1 font-semibold">{order.courier_name || 'Being assigned'}</p></div><div><small className="eyebrow">Shiprocket tracking ID</small><p className="mt-1 break-all font-semibold">{order.shiprocket_awb_code || order.shiprocket_shipment_id || 'Awaiting dispatch'}</p></div></div>}{order.shipment_note && <p className="mt-3 text-xs text-muted">Shipping update: {order.shipment_note}</p>}</article>)}{!orders.length && <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-12 text-center"><h2 className="font-display text-2xl">No orders yet</h2><p className="mt-2 text-sm text-muted">Your successful Artiste purchases will appear here.</p><a href="/#gallery" className="btn-primary mt-5">Explore the collection ↗</a></div>}</section> : <section className="mt-5 max-w-3xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft"><h2 className="mb-2 font-display text-3xl">My Details</h2><p className="mb-5 text-xs leading-5 text-muted">These saved details are used at checkout. Your address and order history are private to your account.</p><form onSubmit={save} className="grid gap-4"><IndianAddressForm value={profile} onChange={updateProfile} showContact /><button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save Customer details'} ↗</button></form></section>}
    </>}
    <p className="mt-14 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Customer account</p>
  </div></main>;
}
