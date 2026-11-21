"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const blank = { title: '', medium: '', dimensions: '', price: '', weight_kg: '', length_cm: '', breadth_cm: '', height_cm: '' };
const tabs = ['Paintings', 'Artists', 'Orders'];
const dash = (v) => v || '—';

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
          <a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span><b className="block font-display text-2xl">Artiste</b><small className="eyebrow">Owner control centre</small></span></a>
          <div className="flex items-center gap-4"><button onClick={logout} className="text-xs font-bold uppercase tracking-wider text-clay">Sign out</button><a href="/" className="text-xs font-bold uppercase tracking-wider text-clay">← View gallery</a></div>
        </header>
        <div className="mb-7 flex flex-wrap gap-2">
          {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? 'bg-ink text-white' : 'border border-[#d9cfc1] text-ink'}`}>{t}</button>)}
          <button onClick={() => load().catch((e) => setError(e.message))} className="ml-auto rounded-full border border-[#d9cfc1] px-4 py-2 text-xs">Refresh ↻</button>
        </div>
        {notice && <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {tab === 'Paintings' && <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
          <section className="h-fit rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft">
            <h2 className="font-display text-3xl">Add owner artwork</h2>
            <form onSubmit={upload} className="mt-5 grid gap-3">
              <label className="label">Artwork photo<input id="owner-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="mt-2 block w-full text-xs"/></label>
              {[['title', 'Title'], ['medium', 'Medium'], ['dimensions', 'Canvas size'], ['price', 'Price (INR)'], ['weight_kg', 'Packed weight (kg)']].map(([n, l]) => <label key={n} className="label">{l}<input name={n} value={form[n]} onChange={update} required className="field mt-1" type={['price', 'weight_kg'].includes(n) ? 'number' : 'text'} step={['price', 'weight_kg'].includes(n) ? '0.01' : undefined} min={['price', 'weight_kg'].includes(n) ? '0.01' : undefined}/></label>)}
              <div className="grid grid-cols-3 gap-2">{['length_cm', 'breadth_cm', 'height_cm'].map((n) => <label key={n} className="label">{n.replace('_cm', '')} cm<input name={n} value={form[n]} onChange={update} required type="number" min="0.1" step="0.1" className="field mt-1"/></label>)}</div>
              <button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Publish artwork'} ↗</button>
            </form>
          </section>
          <section><h2 className="mb-4 font-display text-3xl">All artworks <span className="text-muted">({paintings.length})</span></h2><div className="grid gap-3">
            {paintings.map((p) => <article key={p.id} className="flex gap-3 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-3"><img src={p.image_url} alt={p.title} className="h-24 w-20 rounded-xl object-cover"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="font-display text-xl">{p.title}</b><span className="pill">{p.is_sold ? 'Sold' : 'Available'}</span><span className="pill">{p.is_approved ? 'Approved' : 'Pending'}</span></div><p className="text-xs text-muted">Created by {p.artist_name || 'Artiste Studio'} · {money(p.price)}</p><div className="mt-2 flex flex-wrap gap-2"><button className="action-btn" disabled={busy} onClick={() => updatePainting(p, { is_sold: !p.is_sold })}>Mark {p.is_sold ? 'available' : 'sold'}</button><button className="action-btn" disabled={busy} onClick={() => updatePainting(p, { is_approved: !p.is_approved })}>{p.is_approved ? 'Unpublish' : 'Approve'}</button><button className="action-btn danger" disabled={busy} onClick={() => deletePainting(p)}>Delete</button></div></div></article>)}
          </div></section>
        </div>}

        {tab === 'Artists' && <section>
          <h2 className="mb-4 font-display text-3xl">Artist applications <span className="text-muted">({artists.length})</span></h2>
          <div className="grid gap-4 md:grid-cols-2">
            {artists.map((a) => <article key={a.id} className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5">
              <div className="flex gap-4"><img src={a.profile_photo_url} alt={a.artist_name} className="h-20 w-20 rounded-full object-cover"/><div className="min-w-0"><h3 className="font-display text-2xl">{a.artist_name}</h3><p className="text-xs text-muted">{a.city}, {a.state} · {a.is_approved ? 'Approved' : 'Awaiting approval'}</p><p className="mt-2 text-sm">{a.bio}</p><p className="mt-2 break-all text-xs text-muted">{a.email}</p></div></div>
              <div className="mt-4 rounded-xl bg-[#f7f1e8] p-3 text-xs leading-5"><b>Pickup / dispatch details</b><br/>{dash(a.pickup_contact_name)} · {dash(a.pickup_phone)}<br/>{dash(a.pickup_address)}, {dash(a.pickup_landmark)}, {dash(a.pickup_locality)}, {dash(a.city)}, {dash(a.state)} – {dash(a.pickup_pincode)}<br/>Shiprocket pickup location: {dash(a.pickup_location)}</div>
              <div className="mt-3 rounded-xl border border-[#eee6db] p-3 text-xs leading-5"><b>Verified payout details</b><br/>{a.payout_account?.verified_at ? 'IFSC verified' : 'Not verified'} · {dash(a.payout_account?.account_holder_name)}<br/>A/c {dash(a.payout_account?.bank_account_number || a.payout_account?.bank_account_number_masked)} · {dash(a.payout_account?.ifsc_code)}<br/>{dash(a.payout_account?.bank_name)} · {dash(a.payout_account?.branch_name)}<br/>UPI: {dash(a.payout_account?.upi_id)}</div>
              <div className="mt-4 flex gap-2"><button disabled={busy} className="action-btn" onClick={() => updateArtist(a, { is_approved: !a.is_approved })}>{a.is_approved ? 'Suspend' : 'Approve Artist'}</button><button disabled={busy} className="action-btn danger" onClick={() => deleteArtist(a)}>Delete Artist</button></div>
            </article>)}
          </div>
          {!artists.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">No Artist profiles yet.</p>}
        </section>}

        {tab === 'Orders' && <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-3xl">Customer orders <span className="text-muted">({orders.length})</span></h2><p className="mt-1 text-xs text-muted">Private owner ledger: Customer details, dispatch origins, courier records and Artist payout information.</p></div><span className="pill">Owner-only financial ledger</span></div>
          <div className="grid gap-4">
            {orders.map((o) => {
              const orderPayouts = payouts.filter((p) => p.order_id === o.id);
              return <article key={o.id} className="overflow-hidden rounded-2xl border border-[#e5dccf] bg-[#fffdf8]">
                <div className="grid gap-4 bg-[#f0e9df] p-4 md:grid-cols-4">
                  <div><small className="eyebrow">Order reference</small><p className="font-semibold">{o.merchant_order_ref}</p><p className="mt-1 text-xs text-muted">{new Date(o.created_at).toLocaleString('en-IN')}</p></div>
                  <div><small className="eyebrow">Customer</small><p className="font-semibold">{o.customer_name || o.buyer_name}</p><p className="text-xs">{o.customer_email || o.buyer_email}</p><p className="text-xs">{o.customer_phone || o.buyer_phone}</p></div>
                  <div><small className="eyebrow">Total / Payment</small><p className="font-semibold">{money(o.total_amount ?? o.amount_paise / 100)} · {o.status}</p><p className="text-xs text-muted">Ship: {money(o.shipping_amount ?? o.shipping_price)}</p></div>
                  <div><small className="eyebrow">Artiste commission ledger</small><p className="font-semibold">Platform fee (2%): {money(o.platform_fee)}</p><p className="text-sm font-semibold text-clay">Artist payout (98%): {money(o.artist_payout)}</p><p className="text-xs text-muted">Payout status: {o.payout_status || 'Pending'}</p></div>
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
                {orderPayouts.length > 0 && <div className="border-t border-[#eee6db] p-4"><h3 className="mb-3 font-display text-xl">Payout actions for this order</h3><div className="grid gap-2 md:grid-cols-2">{orderPayouts.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eee6db] p-3 text-xs"><div><b>{row.artist_name}</b><p>{money(row.gross_amount)} sale · {money(row.platform_fee)} fee · {money(row.artist_payout)} net</p><p className="text-muted">{row.payout_status || 'Pending'}</p></div><button disabled={busy} className="action-btn" onClick={() => updatePayout(row, row.payout_status === 'Paid' ? 'Pending' : 'Paid')}>{row.payout_status === 'Paid' ? 'Set payout pending' : 'Mark Payout Paid'}</button></div>)}</div></div>}
              </article>;
            })}
            {!orders.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">Customer orders will appear here after payment confirmation.</p>}
          </div>
          <div className="mt-9"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-display text-2xl">Complete Artist earnings &amp; payout ledger</h3><p className="mt-1 text-xs text-muted">Only mark Paid after you have actually transferred the amount outside Artiste.</p></div><span className="pill">{payouts.length} Artist ledger entries</span></div>
            <div className="overflow-x-auto rounded-2xl border border-[#e5dccf] bg-[#fffdf8]"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Artist','Sale value','Platform fee · 2%','Artist payout · 98%','Payout status','Action'].map((x) => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{payouts.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref}</td><td className="p-4 font-semibold">{row.artist_name}</td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(row.platform_fee)}</td><td className="p-4 font-semibold text-clay">{money(row.artist_payout)}</td><td className="p-4">{row.payout_status}</td><td className="p-4"><button disabled={busy} className="action-btn" onClick={() => updatePayout(row, row.payout_status === 'Paid' ? 'Pending' : 'Paid')}>{row.payout_status === 'Paid' ? 'Set pending' : 'Mark Payout Paid'}</button></td></tr>)}</tbody></table>{!payouts.length && <p className="p-8 text-center text-sm text-muted">Artist payout entries appear after paid orders.</p>}</div>
          </div>
        </section>}
        <p className="mt-12 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Owner dashboard</p>
      </div>
    </main>
  );
}
