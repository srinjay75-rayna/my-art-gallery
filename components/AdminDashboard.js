"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Download, RefreshCw, ShieldCheck, Trash2, UserRound, Wallet, XCircle, FileText } from 'lucide-react';

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const blank = { title: '', medium: '', dimensions: '', price: '', weight_kg: '0.5', length_cm: '', breadth_cm: '', height_cm: '' };
const tabs = ['Paintings', 'Artists', 'Orders', 'ACCOUNTS & LEDGER'];
const dash = (v) => v || '—';
const roleName = (value) => value === 'Photographer' ? 'Photographer' : 'Artist';
const roleRate = (value) => value === 'Photographer' ? 0.05 : 0.02;
const csv = (value) => `\"${String(value ?? '').replaceAll('\"', '\"\"')}\"`;

function makeAccountsLedger(payouts, orders, artists) {
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
  return payouts.map((row) => {
    const order = orderMap.get(row.order_id) || {};
    const creator = artistMap.get(row.artist_id) || {};
    const creatorRole = row.creator_role || creator.creator_role || 'Painter';
    const matchedItems = (Array.isArray(order.items) ? order.items : []).filter((item) =>
      String(item.artist_id || '') === String(row.artist_id || '') ||
      (!item.artist_id && String(item.artist_name || '').trim().toLowerCase() === String(row.artist_name || '').trim().toLowerCase())
    );
    const shipmentMatches = (order.shipments || []).filter((shipment) => String(shipment.artist_id || '') === String(row.artist_id || ''));
    const shippingCollected = shipmentMatches.reduce((total, shipment) => total + Number(shipment.shipping_amount || 0), 0) ||
      ((orderPayoutCount(payouts, row.order_id) === 1) ? Number(order.shipping_amount ?? order.shipping_price ?? 0) : 0);
    return {
      ...row, order, creator, creator_role: creatorRole, commission_rate: Number(row.commission_rate ?? roleRate(creatorRole)),
      order_date: order.paid_at || order.created_at || row.created_at,
      item_title: matchedItems.map((item) => item.title || item.painting_title).filter(Boolean).join(', ') || 'Artwork',
      shipping_collected: shippingCollected,
    };
  });
}

function orderPayoutCount(payouts, orderId) { return payouts.filter((entry) => entry.order_id === orderId).length; }

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState('Paintings');
  const [paintings, setPaintings] = useState([]);
  const [artists, setArtists] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [form, setForm] = useState(blank);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = async (url, options = {}) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };
  const load = useCallback(async () => {
    const [p, o] = await Promise.all([request('/api/admin/paintings'), request('/api/admin/overview')]);
    setPaintings(p.paintings || []);
    setArtists(o.artists || []);
    setOrders(o.orders || []);
    setPayouts(o.payouts || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const accountsLedger = makeAccountsLedger(payouts, orders, artists);

  function downloadAccountsCsv() {
    const headers = ['Order ID', 'Date', 'Item Title', 'Creator Name', 'Creator Role', 'Gross Sale INR', 'Shipping Collected INR', 'Platform Commission INR', 'Commission Rate', 'Net Creator Payout INR', 'Payout Status'];
    const rows = accountsLedger.map((row) => [row.order_ref || row.order_id, row.order_date, row.item_title, row.artist_name || row.creator?.artist_name, row.creator_role, row.gross_amount, row.shipping_collected, row.platform_fee, `${(row.commission_rate * 100).toFixed(0)}%`, row.artist_payout, row.payout_status || 'Pending']);
    const content = [headers, ...rows].map((line) => line.map(csv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `artiste-accounts-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.refresh();
  }
  function update(e) { setForm({ ...form, [e.target.name]: e.target.value }); }
  async function upload(e) {
    e.preventDefault();
    if (!photo) return setError('Choose an artwork photo.');
    setBusy(true); setError(''); setNotice('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => data.append(k, v));
      data.append('photo', photo);
      await request('/api/admin/paintings', { method: 'POST', body: data });
      setForm(blank); setPhoto(null);
      const input = document.getElementById('owner-photo'); if (input) input.value = '';
      setNotice('Artwork added to the public gallery.'); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function updatePainting(p, patch) {
    setBusy(true); setError('');
    try { await request(`/api/admin/paintings/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function deletePainting(p) {
    if (!confirm(`Delete “${p.title}”?`)) return;
    setBusy(true);
    try { await request(`/api/admin/paintings/${p.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function updateArtist(a, patch) {
    setBusy(true);
    try { await request(`/api/admin/artists/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function deleteArtist(a) {
    if (!confirm(`Delete Artist ${a.artist_name} and their artworks?`)) return;
    setBusy(true);
    try { await request(`/api/admin/artists/${a.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function updatePayout(row, payout_status) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/api/admin/payouts/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payout_status }) });
      setNotice(payout_status === 'Paid' ? `Payout marked Paid for ${row.artist_name}.` : `Payout for ${row.artist_name} returned to Pending.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="paper-grain min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span><b className="block font-display text-2xl">Artiste</b><small className="eyebrow flex items-center gap-1"><ShieldCheck size={11}/> Private studio vault</small></span></a>
          <div className="flex items-center gap-4"><button onClick={logout} className="text-xs font-bold uppercase tracking-wider text-clay">Sign out</button><a href="/" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={13}/> View gallery</a></div>
        </header>
        <div className="mb-7 flex flex-wrap gap-2">
          {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? 'bg-ink text-white' : 'border border-[#d9cfc1] text-ink'}`}>{t}</button>)}
          <button onClick={() => load().catch((e) => setError(e.message))} className="ml-auto inline-flex items-center gap-2 rounded-full border border-[#d9cfc1] px-4 py-2 text-xs"><RefreshCw size={13}/> Refresh</button>
        </div>
        {notice && <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {tab === 'Paintings' && <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
          <section className="h-fit rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft">
            <h2 className="font-display text-3xl">Add owner artwork</h2>
            <form onSubmit={upload} className="mt-5 grid gap-3">
              <label className="label">Artwork photo<input id="owner-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="mt-2 block w-full text-xs"/></label>
              {[['title', 'Title'], ['medium', 'Medium'], ['dimensions', 'Canvas size'], ['price', 'Price (INR)'], ['weight_kg', 'Packed weight (kg)']].map(([n, l]) => <label key={n} className="label">{l}<input name={n} value={form[n]} onChange={update} required className="field mt-1" type={['price', 'weight_kg'].includes(n) ? 'number' : 'text'} step={n === 'weight_kg' ? '0.1' : n === 'price' ? '0.01' : undefined} min={n === 'weight_kg' ? '0.2' : n === 'price' ? '1' : undefined}/></label>)}
              <div className="grid grid-cols-3 gap-2">{['length_cm', 'breadth_cm', 'height_cm'].map((n) => <label key={n} className="label">{n.replace('_cm', '')} cm<input name={n} value={form[n]} onChange={update} required type="number" min="0.1" step="0.1" className="field mt-1"/></label>)}</div>
              <button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Publish artwork'} <ArrowUpRight size={15}/></button>
            </form>
          </section>
          <section><h2 className="mb-4 font-display text-3xl">All artworks <span className="text-muted">({paintings.length})</span></h2><div className="grid gap-3">
            {paintings.map((p) => <article key={p.id} className="flex gap-3 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-3"><img src={p.image_url} alt={p.title} className="h-24 w-20 rounded-xl object-cover"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="font-display text-xl">{p.title}</b><span className="pill">{p.is_sold ? 'Sold' : 'Available'}</span><span className="pill">{p.is_approved ? 'Approved' : 'Pending'}</span></div><p className="text-xs text-muted">Created by {p.artist_name || 'Artiste Studio'} · {money(p.price)}</p><div className="mt-2 flex flex-wrap gap-2"><button className="action-btn" disabled={busy} onClick={() => updatePainting(p, { is_sold: !p.is_sold })}>Mark {p.is_sold ? 'available' : 'sold'}</button><button className="action-btn" disabled={busy} onClick={() => updatePainting(p, { is_approved: !p.is_approved })}>{p.is_approved ? 'Unpublish' : 'Approve'}</button><button className="action-btn danger inline-flex items-center gap-1" disabled={busy} onClick={() => deletePainting(p)}><Trash2 size={13}/> Delete</button></div></div></article>)}
          </div></section>
        </div>}

        {tab === 'Artists' && <section>
          <h2 className="mb-4 font-display text-3xl">Artist applications <span className="text-muted">({artists.length})</span></h2>
          <div className="grid gap-4 md:grid-cols-2">
            {artists.map((a) => <article key={a.id} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5">
              <div className="flex gap-4"><img src={a.avatar_url || a.profile_photo_url} alt={a.artist_name} className="h-20 w-20 rounded-full object-cover"/><div className="min-w-0"><h3 className="font-display text-2xl">{a.artist_name}</h3><p className="text-[10px] font-bold uppercase tracking-widest text-clay">{roleName(a.creator_role)} · {a.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio'}</p><p className="text-xs text-muted">{a.city}, {a.state} · {a.is_suspended ? 'Suspended' : a.is_approved ? 'Active' : 'Completing setup'}</p><p className="mt-2 text-sm">{a.bio}</p><p className="mt-2 break-all text-xs text-muted">{a.email}</p></div></div>
              <div className="mt-4 rounded-xl bg-[#F3ECE1] p-3 text-xs leading-5"><b>Pickup / dispatch details</b><br/>{dash(a.pickup_contact_name)} · {dash(a.pickup_phone)}<br/>{dash(a.pickup_address)}, {dash(a.pickup_landmark)}, {dash(a.pickup_locality)}, {dash(a.city)}, {dash(a.state)} – {dash(a.pickup_pincode)}<br/>Shiprocket pickup location: {dash(a.pickup_location)}</div>
              <div className="mt-3 rounded-xl border border-[#eee6db] p-3 text-xs leading-5"><b>Verified payout details</b><br/>{a.payout_account?.verified_at ? 'IFSC verified' : 'Not verified'} · {dash(a.payout_account?.account_holder_name)}<br/>A/c {dash(a.payout_account?.bank_account_number || a.payout_account?.bank_account_number_masked)} · {dash(a.payout_account?.ifsc_code)}<br/>{dash(a.payout_account?.bank_name)} · {dash(a.payout_account?.branch_name)}<br/>UPI: {dash(a.payout_account?.upi_id)}</div>
              <div className="mt-4 flex gap-2"><button disabled={busy} className="action-btn" onClick={() => updateArtist(a, { is_approved: Boolean(a.is_suspended || !a.is_approved) })}>{a.is_suspended ? 'Reactivate Artist' : 'Suspend'}</button><button disabled={busy} className="action-btn danger" onClick={() => deleteArtist(a)}>Delete Artist</button></div>
            </article>)}
          </div>
          {!artists.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">No Artist profiles yet.</p>}
        </section>}

        {tab === 'Orders' && <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-3xl">Customer orders <span className="text-muted">({orders.length})</span></h2><p className="mt-1 text-xs text-muted">Private owner ledger: Customer details, dispatch origins, courier records and Artist payout information.</p></div><span className="pill">Owner-only financial ledger</span></div>
          <div className="grid gap-4">
            {orders.map((o) => {
              const orderPayouts = payouts.filter((p) => p.order_id === o.id);
              return <article key={o.id} className="overflow-hidden rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]">
                <div className="grid gap-4 bg-[#f0e9df] p-4 md:grid-cols-4">
                  <div><small className="eyebrow">Order reference</small><p className="font-semibold">{o.merchant_order_ref}</p><p className="mt-1 text-xs text-muted">{new Date(o.created_at).toLocaleString('en-IN')}</p>{String(o.status || '').toLowerCase() === 'paid' && <a href={`/invoice/${o.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-clay underline"><FileText size={12}/> Download / Print Bill</a>}</div>
                  <div><small className="eyebrow">Customer</small><p className="font-semibold">{o.customer_name || o.buyer_name}</p><p className="text-xs">{o.customer_email || o.buyer_email}</p><p className="text-xs">{o.customer_phone || o.buyer_phone}</p></div>
                  <div><small className="eyebrow">Total / Payment</small><p className="font-semibold">{money(o.total_amount ?? o.amount_paise / 100)} · {o.status}</p><p className="text-xs text-muted">Ship: {money(o.shipping_amount ?? o.shipping_price)}</p></div>
                  <div><small className="eyebrow">Role-based commission ledger</small><p className="font-semibold">Platform fee: {money(orderPayouts.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0))}</p><p className="text-sm font-semibold text-clay">Creator net payout: {money(orderPayouts.reduce((sum, row) => sum + Number(row.artist_payout || 0), 0))}</p><p className="text-xs text-muted">{orderPayouts.map((row) => `${roleName(row.creator_role)} ${Math.round(Number(row.commission_rate ?? roleRate(row.creator_role)) * 100)}%`).join(' · ') || 'No creator ledger'} · Payout: {o.payout_status || 'Pending'}</p></div>
                </div>
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#eee6db] p-3 text-xs leading-5"><b className="eyebrow">Customer delivery address</b><p className="mt-2">{dash(o.shipping_address || o.buyer_address)}, {dash(o.landmark)}, {dash(o.locality || o.city || o.buyer_city)}, {dash(o.city)}, {dash(o.state || o.buyer_state)} – {dash(o.pincode || o.buyer_pincode)}</p></div>
                  <div className="rounded-xl border border-[#eee6db] p-3 text-xs leading-5"><b className="eyebrow">Purchased artworks</b>{Array.isArray(o.items) ? o.items.map((item, index) => <p key={`${item.id || item.painting_id || index}`} className="mt-1">{item.title || item.painting_title || 'Artwork'} · {item.artist_name || 'Artiste Studio'} · {money(item.price || item.unit_price)}</p>) : <p className="mt-1">{o.painting_title}</p>}</div>
                </div>
                <div className="border-t border-[#eee6db] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-xl">Artist dispatch &amp; courier details</h3><span className="pill">{(o.shipments || []).length} shipment group(s)</span></div>
                  {(o.shipments || []).length ? <div className="grid gap-3 xl:grid-cols-2">{o.shipments.map((s) => <div key={s.id} className="rounded-xl bg-[#f8f4ed] p-4 text-xs leading-5">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><b>{s.artist_dispatch?.artist_name || s.artist_name || 'Artist'}</b><p>{s.courier_name || 'Courier awaiting assignment'} · {s.shipment_status || 'Pending'}</p></div><span className="pill">{money(s.shipping_amount ?? s.shipping_price)}</span></div>
                    <p className="mt-2">AWB / Tracking: <b>{s.awb_code || s.shiprocket_awb_code || s.shiprocket_shipment_id || 'Awaiting dispatch'}</b></p>
                    <p>Shiprocket order: {dash(s.shiprocket_order_id)} · Pickup PIN: {dash(s.pickup_pincode)}</p>
                    {s.shipment_note && <p className="mt-1 text-red-700">{s.shipment_note}</p>}
                    <div className="mt-3 border-t border-[#e6ddd1] pt-3"><b>Artist pickup location</b><p>{dash(s.artist_dispatch?.pickup_contact_name)} · {dash(s.artist_dispatch?.pickup_phone)}</p><p>{dash(s.artist_dispatch?.pickup_address)}, {dash(s.artist_dispatch?.pickup_landmark)}, {dash(s.artist_dispatch?.pickup_locality)}, {dash(s.artist_dispatch?.city)}, {dash(s.artist_dispatch?.state)} – {dash(s.artist_dispatch?.pickup_pincode)}</p><p>Shiprocket registered pickup: {dash(s.artist_dispatch?.pickup_location)}</p></div>
                    <div className="mt-3 border-t border-[#e6ddd1] pt-3"><b>Verified Artist bank / UPI details</b><p>{dash(s.payout_account?.account_holder_name)} · A/c {dash(s.payout_account?.bank_account_number || s.payout_account?.bank_account_number_masked)}</p><p>{dash(s.payout_account?.bank_name)} · {dash(s.payout_account?.branch_name)} · IFSC {dash(s.payout_account?.ifsc_code)}</p><p>UPI: {dash(s.payout_account?.upi_id)} · {s.payout_account?.verified_at ? 'IFSC verified' : 'Not verified'}</p></div>
                  </div>)}</div> : <p className="rounded-xl border border-dashed p-4 text-xs text-muted">No shipment records are attached to this order yet. Check the payment / fulfilment event log before dispatch.</p>}
                </div>
                {orderPayouts.length > 0 && <div className="border-t border-[#eee6db] p-4"><h3 className="mb-3 font-display text-xl">Payout actions for this order</h3><div className="grid gap-2 md:grid-cols-2">{orderPayouts.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eee6db] p-3 text-xs"><div><b>{row.artist_name} · {roleName(row.creator_role)}</b><p>{money(row.gross_amount)} sale · {money(row.platform_fee)} fee ({Math.round(Number(row.commission_rate ?? roleRate(row.creator_role)) * 100)}%) · {money(row.artist_payout)} net</p><p className="text-muted">{row.payout_status || 'Pending'}</p></div><button disabled={busy} className="action-btn" onClick={() => updatePayout(row, row.payout_status === 'Paid' ? 'Pending' : 'Paid')}>{row.payout_status === 'Paid' ? 'Set payout pending' : 'Mark Payout Paid'}</button></div>)}</div></div>}
              </article>;
            })}
            {!orders.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">Customer orders will appear here after payment confirmation.</p>}
          </div>
          <div className="mt-9"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-display text-2xl">Complete Artist earnings &amp; payout ledger</h3><p className="mt-1 text-xs text-muted">Only mark Paid after you have actually transferred the amount outside Artiste.</p></div><span className="pill">{payouts.length} Artist ledger entries</span></div>
            <div className="overflow-x-auto rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Creator / role','Sale value','Platform commission','Net creator payout','Payout status','Action'].map((x) => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{payouts.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref}</td><td className="p-4 font-semibold">{row.artist_name}<small className="block text-[10px] font-normal text-muted">{roleName(row.creator_role)} · {Math.round(Number(row.commission_rate ?? roleRate(row.creator_role)) * 100)}%</small></td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(row.platform_fee)}</td><td className="p-4 font-semibold text-clay">{money(row.artist_payout)}</td><td className="p-4">{row.payout_status}</td><td className="p-4"><button disabled={busy} className="action-btn" onClick={() => updatePayout(row, row.payout_status === 'Paid' ? 'Pending' : 'Paid')}>{row.payout_status === 'Paid' ? 'Set pending' : 'Mark Payout Paid'}</button></td></tr>)}</tbody></table>{!payouts.length && <p className="p-8 text-center text-sm text-muted">Artist payout entries appear after paid orders.</p>}</div>
          </div>
        </section>}
        {tab === 'ACCOUNTS & LEDGER' && <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Private owner accounting</p><h2 className="mt-2 font-display text-3xl">ACCOUNTS &amp; LEDGER</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Order-wise creator receivables, role-based commission, shipping collected and manual settlement status. Shipping is shown separately and is not included in the commission base.</p></div><button onClick={downloadAccountsCsv} disabled={!accountsLedger.length} className="btn-primary inline-flex items-center gap-2"><Download size={14}/> Export CSV</button></div>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Gross sales', accountsLedger.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0)],
              ['Shipping collected', accountsLedger.reduce((sum, row) => sum + Number(row.shipping_collected || 0), 0)],
              ['Platform commission', accountsLedger.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0)],
              ['Net creator payout payable', accountsLedger.filter((row) => row.payout_status !== 'Paid').reduce((sum, row) => sum + Number(row.artist_payout || 0), 0)],
            ].map(([label, total]) => <div key={label} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">{label}</p><p className="mt-2 font-display text-3xl">{money(total)}</p></div>)}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]"><table className="w-full min-w-[1350px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order ID','Date','Item title','Creator / role','Gross sale','Shipping collected','Platform commission','Net payout payable','Settlement status','Action'].map((heading) => <th className="p-3" key={heading}>{heading}</th>)}</tr></thead><tbody>{accountsLedger.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-3">{row.order_ref || row.order_id}</td><td className="p-3">{row.order_date ? new Date(row.order_date).toLocaleDateString('en-IN') : '—'}</td><td className="p-3">{row.item_title}</td><td className="p-3"><b>{row.artist_name}</b><small className="block text-[10px] text-muted">{roleName(row.creator_role)}</small></td><td className="p-3">{money(row.gross_amount)}</td><td className="p-3">{money(row.shipping_collected)}</td><td className="p-3">{money(row.platform_fee)} <small className="text-muted">({Math.round(row.commission_rate * 100)}%)</small></td><td className="p-3 font-semibold text-clay">{money(row.artist_payout)}</td><td className="p-3">{row.payout_status || 'Pending'}</td><td className="p-3"><button disabled={busy} className="action-btn" onClick={() => updatePayout(row, row.payout_status === 'Paid' ? 'Pending' : 'Paid')}>{row.payout_status === 'Paid' ? 'Mark Pending' : 'Mark Paid'}</button></td></tr>)}</tbody></table>{!accountsLedger.length && <p className="p-8 text-center text-sm text-muted">Accounting entries will appear after successful paid orders have been allocated to creators.</p>}</div>
          <p className="mt-3 text-[10px] text-muted">Settlement flags are manual bookkeeping markers only. Artiste does not initiate bank transfers automatically; mark a payout Paid only after it has actually been transferred.</p>
        </section>}
        <p className="mt-12 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Owner dashboard</p>
      </div>
    </main>
  );
}
