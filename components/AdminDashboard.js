"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Download, RefreshCw, ShieldCheck, Trash2, UserRound, Wallet, XCircle, FileText, Plus, Printer, X } from 'lucide-react';

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const blank = { title: '', medium: '', dimensions: '', price: '', weight_kg: '0.5', length_cm: '', breadth_cm: '', height_cm: '' };
const tabs = ['Paintings', 'Artists', 'Founding Applications', 'Orders', 'ACCOUNTS & LEDGER'];
const dash = (v) => v || '—';
const roleName = (value) => value === 'Photographer' ? 'Photographer' : 'Artist';
const roleRate = (_value, isFoundingArtist = false) => isFoundingArtist ? 0.20 : 0.25;
const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function makeAccountingVoucherRows(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const voucher = entry.voucher || {};
    const key = voucher.id || entry.voucher_id || entry.id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        date: voucher.voucher_date || entry.created_at || '',
        voucherNo: voucher.voucher_no || `VCH-${String(voucher.id || key).slice(0, 8).toUpperCase()}`,
        particulars: voucher.description || entry.description || 'Automated accounting entry',
        reference: voucher.reference || '',
        debits: [],
        credits: [],
        debitTotal: 0,
        creditTotal: 0,
      });
    }
    const row = grouped.get(key);
    const account = entry.ledger
      ? `${entry.ledger.ledger_code || ''} · ${entry.ledger.ledger_name || 'Ledger'}`.trim()
      : 'Ledger';
    const debit = Number(entry.debit || 0);
    const credit = Number(entry.credit || 0);
    if (debit > 0) {
      row.debits.push({ account, amount: debit });
      row.debitTotal += debit;
    }
    if (credit > 0) {
      row.credits.push({ account, amount: credit });
      row.creditTotal += credit;
    }
  }
  return Array.from(grouped.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const LEGACY_AGREEMENT_TEXTS = { original_work: 'I confirm that every submitted artwork is 100% original work created by me and that I hold the rights to sell it.', commission_and_payout: 'I agree to the 70% Artist / 30% Platform split, or the 80% Artist / 20% Platform split if I am approved as a Founding Artist, and understand payout is released 48 hours after courier delivery is marked Delivered.', secure_packing: 'I agree to securely pack each sold artwork and make it ready for courier pickup within 48 hours of the order.', promotion_permission: 'I permit Artiste to use approved artwork photos and promotional / behind-the-scenes clips to market my work.' };

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
    const courierCost = shipmentMatches.reduce((total, shipment) => total + Number(shipment.shipping_amount || 0), 0) ||
      ((orderPayoutCount(payouts, row.order_id) === 1) ? Number(order.courier_cost || 0) : 0);
    const commissionRate = Number(row.commission_rate ?? roleRate(creatorRole, creator.is_founding_artist));
    return {
      ...row,
      order,
      creator,
      creator_role: creatorRole,
      commission_rate: commissionRate,
      platform_fee: Number(row.platform_fee ?? (Number(row.gross_amount || 0) * commissionRate)),
      artist_payout: Number(row.artist_payout ?? (Number(row.gross_amount || 0) * (1 - commissionRate))),
      order_date: order.paid_at || order.created_at || row.created_at,
      item_title: matchedItems.map((item) => item.title || item.painting_title).filter(Boolean).join(', ') || 'Artwork',
      courier_cost: courierCost,
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
  const [foundingApplications, setFoundingApplications] = useState([]);
  const [approvedApplications, setApprovedApplications] = useState([]);
  const [accountingLedgers, setAccountingLedgers] = useState([]);
  const [accountingEntries, setAccountingEntries] = useState([]);
  const [payoutModalRow, setPayoutModalRow] = useState(null);
  const [payoutPayment, setPayoutPayment] = useState({ amount: '', utr: '', proof: null });
  const [ledgerForm, setLedgerForm] = useState({ ledger_code: '', ledger_name: '', ledger_type: 'asset', description: '' });
  const [showLedgerCreator, setShowLedgerCreator] = useState(false);
  const [accountingReport, setAccountingReport] = useState('trial-balance');
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
    const [p, o, fa, ac] = await Promise.all([request('/api/admin/paintings'), request('/api/admin/overview'), request('/api/admin/artist-applications'), request('/api/owner/accounting').catch(() => ({ ledgers: [], entries: [] }))]);
    setFoundingApplications(fa.applications || []);
    setApprovedApplications(fa.approvedApplications || []);
    setAccountingLedgers(ac.ledgers || []);
    setAccountingEntries(ac.entries || []);
    setPaintings(p.paintings || []);
    setArtists(o.artists || []);
    setOrders(o.orders || []);
    setPayouts(o.payouts || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    let active = true;
    const refreshPending = async () => {
      try {
        const response = await fetch('/api/admin/artist-applications', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (active && response.ok) { setFoundingApplications(data.applications || []); setApprovedApplications(data.approvedApplications || []); }
      } catch {}
    };
    const timer = setInterval(refreshPending, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const refreshAccounting = async () => {
      try {
        const response = await fetch('/api/owner/accounting', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (active && response.ok) {
          setAccountingLedgers(data.ledgers || []);
          setAccountingEntries(data.entries || []);
        }
      } catch {}
    };
    const timer = setInterval(refreshAccounting, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const accountsLedger = makeAccountsLedger(payouts, orders, artists);
  const accountingVoucherRows = makeAccountingVoucherRows(accountingEntries);
  const foundingSlotsFilled = artists.filter((artist) => Boolean(artist.is_founding_artist)).length;
  const totalSales = orders.filter((order) => String(order.status || '').toLowerCase() === 'paid').reduce((sum, order) => sum + Number(order.total_amount ?? (order.amount_paise != null ? Number(order.amount_paise) / 100 : (order.artwork_price || 0))), 0);
  const pendingArtistPayouts = payouts.reduce((sum, row) => {
    const alreadyPaid = Number(row.payout_paid_amount || 0) || (['Paid', 'paid'].includes(String(row.payout_status || '')) ? Number(row.artist_payout || 0) : 0);
    return sum + Math.max(0, Number(row.artist_payout || 0) - alreadyPaid);
  }, 0);
  const payoutAlreadyPaid = (row) => Number(row.payout_paid_amount || 0) || (['Paid', 'paid'].includes(String(row.payout_status || '')) ? Number(row.artist_payout || 0) : 0);
  const payoutRemaining = (row) => Math.max(0, Number(row.artist_payout || 0) - payoutAlreadyPaid(row));
  const payoutStatusLabel = (row) => {
    const remaining = payoutRemaining(row);
    if (remaining <= 0) return 'Paid';
    if (payoutAlreadyPaid(row) > 0) return `Part-Paid · ${money(remaining)} Pending`;
    return 'Pending';
  };

  function downloadAccountsCsv() {
    const headers = ['Order ID', 'Date', 'Item Title', 'Creator Name', 'Creator Role', 'Gross Sale INR', 'Courier Cost INR', 'Platform Commission INR', 'Commission Rate', 'Net Creator Payout INR', 'Payout Status'];
    const rows = accountsLedger.map((row) => [row.order_ref || row.order_id, row.order_date, row.item_title, row.artist_name || row.creator?.artist_name, row.creator_role, row.gross_amount, row.courier_cost, row.platform_fee, `${(row.commission_rate * 100).toFixed(0)}%`, row.artist_payout, row.payout_status || 'Pending']);
    const content = [headers, ...rows].map((line) => line.map(csv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `artiste-accounts-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include', cache: 'no-store' });
    window.dispatchEvent(new Event('artiste:admin-session'));
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

  function openPayoutModal(row) {
    setPayoutModalRow(row);
    setPayoutPayment({ amount: String(payoutRemaining(row).toFixed(2)), utr: '', proof: null });
    setError('');
  }

  async function submitPayoutPayment(event) {
    event.preventDefault();
    if (!payoutModalRow) return;
    if (!payoutPayment.proof) { setError('Attach the mandatory payment proof photo or receipt.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const body = new FormData();
      body.set('payout_id', payoutModalRow.id);
      body.set('amount_paid', payoutPayment.amount);
      body.set('utr', payoutPayment.utr);
      body.set('proof', payoutPayment.proof);
      const result = await request('/api/owner/payout-proof', { method: 'POST', body });
      setNotice(result.message || 'Payment recorded.');
      setPayoutModalRow(null);
      setPayoutPayment({ amount: '', utr: '', proof: null });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function createCustomLedger(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await request('/api/owner/accounting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_ledger', ...ledgerForm }) });
      setLedgerForm({ ledger_code: '', ledger_name: '', ledger_type: 'asset', description: '' });
      setShowLedgerCreator(false); setNotice('Custom ledger created.'); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }


  function downloadAccountingCsv() {
    const headers = ['Date', 'Voucher No.', 'Particulars', 'Debit (Dr) Accounts', 'Debit (Dr) Amount INR', 'Credit (Cr) Accounts', 'Credit (Cr) Amount INR'];
    const rows = accountingVoucherRows.map((row) => [row.date, row.voucherNo, row.particulars, row.debits.map((line) => line.account).join(' | '), row.debitTotal, row.credits.map((line) => line.account).join(' | '), row.creditTotal]);
    const content = [headers, ...rows].map((line) => line.map(csv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `artiste-accounting-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  function ledgerBalances() {
    return accountingLedgers.map((ledger) => {
      const relevant = accountingEntries.filter((entry) => entry.ledger_id === ledger.id);
      const debit = relevant.reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
      const credit = relevant.reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
      const balance = ['asset', 'expense'].includes(ledger.ledger_type) ? debit - credit : credit - debit;
      return { ...ledger, debit, credit, balance };
    });
  }

  function statementNetProfit(balances = ledgerBalances()) {
    const income = balances.filter((ledger) => ledger.ledger_type === 'income').reduce((sum, ledger) => sum + ledger.balance, 0);
    const expenses = balances.filter((ledger) => ledger.ledger_type === 'expense').reduce((sum, ledger) => sum + ledger.balance, 0);
    return income - expenses;
  }

  function downloadFinancialStatementCsv() {
    const balances = ledgerBalances();
    let headers = [];
    let rows = [];
    if (accountingReport === 'trial-balance') {
      headers = ['Ledger Code', 'Ledger Name', 'Account Type', 'Total Debit INR', 'Total Credit INR', 'Closing Balance INR'];
      rows = balances.map((ledger) => [ledger.ledger_code, ledger.ledger_name, ledger.ledger_type, ledger.debit, ledger.credit, ledger.balance]);
      rows.push(['TOTAL', '', '', balances.reduce((sum, ledger) => sum + ledger.debit, 0), balances.reduce((sum, ledger) => sum + ledger.credit, 0), '']);
    } else if (accountingReport === 'profit-loss') {
      headers = ['Section', 'Ledger Code', 'Ledger Name', 'Amount INR'];
      rows = balances.filter((ledger) => ['income', 'expense'].includes(ledger.ledger_type)).map((ledger) => [ledger.ledger_type, ledger.ledger_code, ledger.ledger_name, ledger.balance]);
      rows.push(['Net profit / (loss)', '', '', statementNetProfit(balances)]);
    } else {
      headers = ['Section', 'Ledger Code', 'Ledger Name', 'Amount INR'];
      rows = balances.filter((ledger) => ['asset', 'liability', 'equity'].includes(ledger.ledger_type)).map((ledger) => [ledger.ledger_type, ledger.ledger_code, ledger.ledger_name, ledger.balance]);
      rows.push(['Equity', '', 'Current earnings', statementNetProfit(balances)]);
    }
    const content = [headers, ...rows].map((line) => line.map(csv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `artiste-${accountingReport}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  async function reviewFoundingApplication(application, decision) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request('/api/admin/artist-applications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: application.id, decision }) });
      setNotice(result.message || 'Application updated.');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="paper-grain min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span><b className="block font-display text-2xl">Artiste</b><small className="eyebrow flex items-center gap-1"><ShieldCheck size={11}/> Private studio vault</small></span></a>
          <div className="flex items-center gap-4"><button onClick={logout} className="text-xs font-bold uppercase tracking-wider text-clay">Sign out</button><a href="/" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={13}/> View gallery</a></div>
        </header>
        <section className="mb-8 rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Host / Studio Vault Profile</p><h1 className="mt-2 font-display text-3xl">Artiste Host</h1><p className="mt-1 text-xs text-muted">Private owner control centre · Founding artist approvals and studio operations</p></div><span className="rounded-full bg-[#173D31] px-4 py-2 text-xs font-semibold text-white">Order-triggered Shiprocket pickup · Payout release after Delivered + 48 hours</span></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl bg-white/70 p-4"><p className="eyebrow">Founding artist slots</p><p className="mt-2 font-display text-2xl">{Math.min(foundingSlotsFilled, 10)} / 10</p><p className="mt-1 text-xs text-muted">Founding Artist 80/20 spots filled · Next tier: 75/25</p></div>
            <div className="rounded-2xl bg-white/70 p-4"><p className="eyebrow">TOTAL SALES</p><p className="mt-2 font-display text-2xl">{money(totalSales)}</p><p className="mt-1 text-xs text-muted">Confirmed customer order revenue</p></div>
            <div className="rounded-2xl bg-white/70 p-4"><p className="eyebrow">Pending artist payouts</p><p className="mt-2 font-display text-2xl">{money(pendingArtistPayouts)}</p><p className="mt-1 text-xs text-muted">After recorded full and partial transfers</p></div>
          </div>
        </section>
        <div className="mb-7 flex flex-wrap gap-2">
           {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? 'bg-ink text-white' : 'border border-[#d9cfc1] text-ink'}`}>{t}{t === 'Founding Applications' && foundingApplications.length > 0 ? ` · ${foundingApplications.length}` : ''}</button>)}
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
              <div className="flex gap-4"><img src={a.avatar_url || a.profile_photo_url} alt={a.artist_name} className="h-20 w-20 rounded-full object-cover"/><div className="min-w-0"><h3 className="font-display text-2xl">{a.artist_name}</h3><p className="text-[10px] font-bold uppercase tracking-widest text-clay">{roleName(a.creator_role)} · {a.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio'}</p><p className="text-xs text-muted">{a.city}, {a.state} · {a.is_suspended ? 'Suspended' : a.is_approved ? 'Active' : 'Completing setup'}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-clay">{a.is_founding_artist ? 'Founding Artist · 80% share / 20% commission' : 'Artist · 75% share / 25% commission'}</p><p className="mt-2 text-sm">{a.bio}</p><p className="mt-2 break-all text-xs text-muted">{a.email}</p></div></div>
              <div className="mt-4 rounded-xl bg-[#F3ECE1] p-3 text-xs leading-5"><b>Pickup / dispatch details</b><br/>{dash(a.pickup_contact_name)} · {dash(a.pickup_phone)}<br/>{dash(a.pickup_address)}, {dash(a.pickup_landmark)}, {dash(a.pickup_locality)}, {dash(a.city)}, {dash(a.state)} – {dash(a.pickup_pincode)}<br/>Shiprocket pickup location: {dash(a.pickup_location)}</div>
              <div className="mt-3 rounded-xl border border-[#eee6db] p-3 text-xs leading-5"><b>Verified payout details</b><br/>{a.payout_account?.verified_at ? 'IFSC verified' : 'Not verified'} · {dash(a.payout_account?.account_holder_name)}<br/>A/c {dash(a.payout_account?.bank_account_number || a.payout_account?.bank_account_number_masked)} · {dash(a.payout_account?.ifsc_code)}<br/>{dash(a.payout_account?.bank_name)} · {dash(a.payout_account?.branch_name)}<br/>UPI: {dash(a.payout_account?.upi_id)}</div>
              <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} className="action-btn" onClick={() => updateArtist(a, { is_approved: Boolean(a.is_suspended || !a.is_approved) })}>{a.is_suspended ? 'Reactivate Artist' : 'Suspend'}</button><span className="pill">Tier assigned automatically at approval</span><button disabled={busy} className="action-btn danger" onClick={() => deleteArtist(a)}>Delete Artist</button></div>
            </article>)}
          </div>
          {!artists.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">No Artist profiles yet.</p>}
        </section>}



        {tab === 'Founding Applications' && <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-3xl">Founding Artist review queue</h2><p className="mt-1 text-xs text-muted">Pending applications are listed first. Tier assignment and the welcome email run automatically when approved.</p></div><span className="rounded-full bg-[#173D31] px-4 py-2 text-xs font-bold text-white">{foundingApplications.length} pending</span></div>
          <div className="grid gap-4">
            {foundingApplications.map((application) => <article key={application.id} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-2xl">{application.studio_name}</h3><p className="text-xs text-muted">{application.full_name} · {application.city} – {application.pincode}</p><p className="mt-1 text-xs">{application.whatsapp_number}{application.instagram_handle ? ` · @${application.instagram_handle}` : ''}</p>{application.email && <p className="mt-1 break-all text-xs text-muted">{application.email}</p>}<p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{application.art_style_bio}</p></div><span className="pill">{application.application_status}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{(Array.isArray(application.artwork_photos) ? application.artwork_photos : []).map((photo, index) => <a key={`${photo}-${index}`} href={photo} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[#D9C6A6]"><img src={photo} alt={`Portfolio photo ${index + 1}`} className="h-36 w-full object-cover"/></a>)}</div>
              <details className="mt-4 rounded-xl border border-[#e8ddcf] bg-white/60 p-3 text-xs"><summary className="cursor-pointer font-semibold">Review the four accepted consent agreements</summary><div className="mt-3 grid gap-2">{['original_work','commission_and_payout','secure_packing','promotion_permission'].map((key) => <p key={key}><b>{key.replaceAll('_', ' ')}:</b> {(application.agreement_texts?.[key] || (application.agreements?.[key] ? LEGACY_AGREEMENT_TEXTS[key] : 'Consent text not recorded'))}</p>)}</div></details>
              <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} className="btn-primary" onClick={() => reviewFoundingApplication(application, 'approve')}>Approve · tier assigned automatically</button><button disabled={busy} className="action-btn danger" onClick={() => reviewFoundingApplication(application, 'decline')}>Decline</button></div>
            </article>)}
            {!foundingApplications.length && <p className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted">No pending Founding Artist applications.</p>}
          </div>
          <div className="mt-10 border-t border-[#D9C6A6] pt-7">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-display text-2xl">Approved Applications</h3><p className="mt-1 text-xs text-muted">Permanent approval archive with submitted details, portfolio links, assigned tier, approval timestamp and accepted agreements.</p></div><span className="pill">{approvedApplications.length} approved</span></div>
            <div className="grid gap-3">{approvedApplications.map((application) => <article key={application.id} className="rounded-2xl border border-[#D9C6A6] bg-[#FAF6F0] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-display text-xl">{application.studio_name}</h4><p className="text-xs text-muted">{application.full_name} · {application.email} · {application.whatsapp_number}</p><p className="mt-1 text-xs text-muted">{application.city} – {application.pincode} · {application.instagram_handle ? `@${application.instagram_handle}` : 'Instagram not supplied'}</p><p className="mt-2 text-xs">{application.approval_tier || (Number(application.commission_rate) === 0.2 ? '80/20' : '75/25')} tier · {application.approved_at ? new Date(application.approved_at).toLocaleString('en-IN') : 'Approval timestamp unavailable'}</p></div><a className="action-btn inline-flex items-center gap-2" href={`/api/admin/artist-applications/${application.id}/pdf`}><FileText size={13}/> Download Approval PDF</a></div><details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Full submitted details and accepted agreements</summary><div className="mt-2 grid gap-2"><p><b>Bio:</b> {application.art_style_bio}</p><p><b>Portfolio:</b> {(application.artwork_photos || []).join(' · ')}</p>{['original_work','commission_and_payout','secure_packing','promotion_permission'].map((key) => <p key={key}><b>{key.replaceAll('_', ' ')}:</b> {(application.agreement_texts?.[key] || (application.agreements?.[key] ? LEGACY_AGREEMENT_TEXTS[key] : 'Consent text not recorded'))}</p>)}</div></details></article>)}
            {!approvedApplications.length && <p className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted">Approved applications will be preserved here for the permanent archive.</p>}</div>
          </div>
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
                  <div><small className="eyebrow">Artist / Platform allocation ledger</small><p className="font-semibold">Platform fee: {money(orderPayouts.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0))}</p><p className="text-sm font-semibold text-clay">Creator net payout: {money(orderPayouts.reduce((sum, row) => sum + Number(row.artist_payout || 0), 0))}</p><p className="text-xs text-muted">{orderPayouts.map((row) => `${roleName(row.creator_role)} ${Math.round(Number(row.commission_rate ?? 0.25) * 100)}%`).join(' · ') || 'No creator ledger'} · Payout: {o.payout_status || 'Pending'}</p></div>
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
                {orderPayouts.length > 0 && <div className="border-t border-[#eee6db] p-4"><h3 className="mb-3 font-display text-xl">Payout actions for this order</h3><div className="grid gap-2 md:grid-cols-2">{orderPayouts.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eee6db] p-3 text-xs"><div><b>{row.artist_name} · {roleName(row.creator_role)}</b><p>{money(row.gross_amount)} sale · {money(row.platform_fee)} fee ({Math.round(Number(row.commission_rate ?? 0.25) * 100)}%) · {money(row.artist_payout)} net</p><p><span className={payoutRemaining(row) <= 0 ? 'inline-flex rounded-full bg-green-100 px-2.5 py-1 font-semibold text-green-800' : payoutAlreadyPaid(row) > 0 ? 'inline-flex rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900' : 'inline-flex rounded-full bg-[#eee6db] px-2.5 py-1 text-muted'}>{payoutStatusLabel(row)}</span></p><p className="text-[10px] text-muted">Paid: {money(payoutAlreadyPaid(row))} · Remaining: {money(payoutRemaining(row))}</p><p className="text-[10px] text-muted">{row.payout_available_at ? `Standard 48-hour cycle ends ${new Date(row.payout_available_at).toLocaleString('en-IN')}` : 'Awaiting Delivered + 48 hours'}</p>{row.payout_proof_signed_url && <a className="text-xs font-semibold text-clay underline" href={row.payout_proof_signed_url} target="_blank" rel="noreferrer">View Payment Proof</a>}</div><button disabled={busy || payoutRemaining(row) <= 0} className="action-btn" onClick={() => openPayoutModal(row)}>Mark Payout Paid</button></div>)}</div></div>}
              </article>;
            })}
            {!orders.length && <p className="rounded-2xl border border-dashed p-10 text-center text-muted">Customer orders will appear here after payment confirmation.</p>}
          </div>
          <div className="mt-9"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-display text-2xl">Complete Artist earnings &amp; payout ledger</h3><p className="mt-1 text-xs text-muted">The standard payout cycle is 48 hours after courier delivery; the Host may record a completed transfer earlier when payment proof is attached.</p></div><span className="pill">{payouts.length} Artist ledger entries</span></div>
            <div className="overflow-x-auto rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Creator / role','Sale value','Platform commission','Net creator payout','Payout status','Action'].map((x) => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{payouts.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref}</td><td className="p-4 font-semibold">{row.artist_name}<small className="block text-[10px] font-normal text-muted">{roleName(row.creator_role)} · {Math.round(Number(row.commission_rate ?? 0.25) * 100)}%</small></td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(row.platform_fee)}</td><td className="p-4 font-semibold text-clay">{money(row.artist_payout)}</td><td className="p-4"><span className={payoutRemaining(row) <= 0 ? 'font-semibold text-green-800' : ''}>{payoutStatusLabel(row)}</span><small className="block text-[10px] text-muted">Paid {money(payoutAlreadyPaid(row))} · Pending {money(payoutRemaining(row))}</small><small className="block text-[10px] text-muted">{row.payout_available_at ? `Standard 48-hour cycle ends ${new Date(row.payout_available_at).toLocaleString('en-IN')}` : 'Awaiting Delivered + 48 hours'}</small>{row.payout_proof_signed_url && <a className="text-xs font-semibold text-clay underline" href={row.payout_proof_signed_url} target="_blank" rel="noreferrer">View Payment Proof</a>}</td><td className="p-4"><button disabled={busy || payoutRemaining(row) <= 0} className="action-btn" onClick={() => openPayoutModal(row)}>Mark Payout Paid</button></td></tr>)}</tbody></table>{!payouts.length && <p className="p-8 text-center text-sm text-muted">Artist payout entries appear after paid orders.</p>}</div>
          </div>
        </section>}
        {tab === 'ACCOUNTS & LEDGER' && <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Private double-entry accounting</p><h2 className="mt-2 font-display text-3xl">ACCOUNTS &amp; LEDGER</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Automatically balanced journals for confirmed artwork sales, customer shipping, platform commission, Shiprocket courier charges and documented Artist payout transfers.</p></div><div className="flex flex-wrap gap-2"><button onClick={downloadAccountingCsv} disabled={!accountingEntries.length} className="btn-secondary inline-flex items-center gap-2"><Download size={14}/> Ledger CSV</button><button onClick={downloadFinancialStatementCsv} disabled={!accountingLedgers.length} className="btn-secondary inline-flex items-center gap-2"><Download size={14}/> Statement CSV</button><button onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2"><Printer size={14}/> Print</button></div></div>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Gross sales GMV', accountsLedger.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0)],
              ['Courier fulfilment amount', accountsLedger.reduce((sum, row) => sum + Number(row.courier_cost || 0), 0)],
              ['Platform commission', accountsLedger.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0)],
              ['Remaining artist payable', accountsLedger.reduce((sum, row) => sum + payoutRemaining(row), 0)],
            ].map(([label, total]) => <div key={label} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">{label}</p><p className="mt-2 font-display text-3xl">{money(total)}</p></div>)}
          </div>
          <div className="grid gap-6">
            <section className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-2xl">Chart of Accounts</h3><p className="text-xs text-muted">System and custom ledgers</p></div><button className="action-btn inline-flex items-center gap-2" onClick={() => setShowLedgerCreator((value) => !value)}><Plus size={13}/> Create Custom Ledger</button></div>
              {showLedgerCreator && <form onSubmit={createCustomLedger} className="mt-4 grid gap-3 rounded-xl border border-[#e2d6c7] bg-white/70 p-4 sm:grid-cols-2"><label className="label">Ledger code<input className="field mt-1" required value={ledgerForm.ledger_code} onChange={(e) => setLedgerForm({ ...ledgerForm, ledger_code: e.target.value })}/></label><label className="label">Ledger name<input className="field mt-1" required value={ledgerForm.ledger_name} onChange={(e) => setLedgerForm({ ...ledgerForm, ledger_name: e.target.value })}/></label><label className="label">Account type<select className="field mt-1" value={ledgerForm.ledger_type} onChange={(e) => setLedgerForm({ ...ledgerForm, ledger_type: e.target.value })}>{['asset','liability','equity','income','expense'].map((type) => <option key={type} value={type}>{type[0].toUpperCase()+type.slice(1)}</option>)}</select></label><label className="label">Description<input className="field mt-1" value={ledgerForm.description} onChange={(e) => setLedgerForm({ ...ledgerForm, description: e.target.value })}/></label><button disabled={busy} className="btn-primary sm:col-span-2">Save Custom Ledger</button></form>}
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead><tr className="border-b border-[#dfd1bd] text-[10px] uppercase tracking-wider"><th className="p-2">Code</th><th className="p-2">Ledger</th><th className="p-2">Type</th><th className="p-2 text-right">Balance</th></tr></thead><tbody>{ledgerBalances().map((ledger) => <tr key={ledger.id} className="border-b border-[#eee6db]"><td className="p-2">{ledger.ledger_code}</td><td className="p-2 font-semibold">{ledger.ledger_name}</td><td className="p-2 capitalize">{ledger.ledger_type}</td><td className="p-2 text-right">{money(ledger.balance)}</td></tr>)}</tbody></table>{!accountingLedgers.length && <p className="p-4 text-xs text-muted">Run the V17 schema migration to initialise the Chart of Accounts.</p>}</div>
            </section>

          </div>
          <div className="mt-8 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-2xl">Financial Statements</h3><p className="text-xs text-muted">Built from posted double-entry ledger movements.</p></div><div className="flex flex-wrap gap-2">{[['trial-balance','Trial Balance'],['profit-loss','Profit & Loss'],['balance-sheet','Balance Sheet']].map(([key,label]) => <button key={key} onClick={() => setAccountingReport(key)} className={`rounded-full px-4 py-2 text-xs font-semibold ${accountingReport === key ? 'bg-ink text-white' : 'border border-[#d9cfc1]'}`}>{label}</button>)}</div></div>
            {accountingReport === 'trial-balance' && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead><tr className="border-b text-[10px] uppercase"><th className="p-3">Ledger</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Balance</th></tr></thead><tbody>{ledgerBalances().map((ledger) => <tr key={ledger.id} className="border-b border-[#eee6db]"><td className="p-3">{ledger.ledger_code} · {ledger.ledger_name}</td><td className="p-3 text-right">{money(ledger.debit)}</td><td className="p-3 text-right">{money(ledger.credit)}</td><td className="p-3 text-right">{money(ledger.balance)}</td></tr>)}</tbody></table></div>}
            {accountingReport === 'profit-loss' && <div className="mt-4 grid gap-5 md:grid-cols-2"><div><h4 className="font-semibold">Income</h4>{ledgerBalances().filter((ledger) => ledger.ledger_type === 'income').map((ledger) => <p key={ledger.id} className="flex justify-between border-b border-[#eee6db] py-2 text-sm"><span>{ledger.ledger_name}</span><b>{money(ledger.balance)}</b></p>)}</div><div><h4 className="font-semibold">Expenses</h4>{ledgerBalances().filter((ledger) => ledger.ledger_type === 'expense').map((ledger) => <p key={ledger.id} className="flex justify-between border-b border-[#eee6db] py-2 text-sm"><span>{ledger.ledger_name}</span><b>{money(ledger.balance)}</b></p>)}</div><p className="font-display text-2xl md:col-span-2">Net Profit / (Loss): {money(ledgerBalances().filter((ledger) => ledger.ledger_type === 'income').reduce((sum, ledger) => sum + ledger.balance, 0) - ledgerBalances().filter((ledger) => ledger.ledger_type === 'expense').reduce((sum, ledger) => sum + ledger.balance, 0))}</p></div>}
            {accountingReport === 'balance-sheet' && <div className="mt-4 grid gap-5 md:grid-cols-3">{[['Assets','asset'],['Liabilities','liability'],['Equity','equity']].map(([label,type]) => <div key={type}><h4 className="font-semibold">{label}</h4>{ledgerBalances().filter((ledger) => ledger.ledger_type === type).map((ledger) => <p key={ledger.id} className="flex justify-between border-b border-[#eee6db] py-2 text-sm"><span>{ledger.ledger_name}</span><b>{money(ledger.balance)}</b></p>)}{type === 'equity' && <p className="flex justify-between border-b border-[#eee6db] py-2 text-sm"><span>Current earnings</span><b>{money(statementNetProfit())}</b></p>}</div>)}</div>}
            <div className="mt-6 border-t border-[#dfd1bd] pt-4"><h4 className="font-display text-xl">Automated double-entry journal</h4><p className="mt-1 text-xs text-muted">Each confirmed sale, shipping allocation, platform commission and recorded Artist payment appears as one balanced voucher.</p><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead><tr className="border-b text-[10px] uppercase"><th className="p-3">Date</th><th className="p-3">Voucher No.</th><th className="p-3">Particulars</th><th className="p-3">Debit (Dr) Account &amp; Amount</th><th className="p-3">Credit (Cr) Account &amp; Amount</th></tr></thead><tbody>{accountingVoucherRows.map((row) => <tr key={row.id} className="border-b border-[#eee6db] align-top"><td className="p-3 whitespace-nowrap">{row.date ? new Date(row.date).toLocaleDateString('en-IN') : '—'}</td><td className="p-3 font-semibold whitespace-nowrap">{row.voucherNo}</td><td className="p-3"><b>{row.particulars}</b>{row.reference && <small className="mt-1 block text-muted">Ref: {row.reference}</small>}</td><td className="p-3"><div className="grid gap-1">{row.debits.map((line, index) => <div key={`${row.id}-dr-${index}`} className="flex flex-wrap justify-between gap-2"><span>{line.account}</span><b className="whitespace-nowrap">{money(line.amount)}</b></div>)}<div className="mt-1 flex justify-between gap-2 border-t border-[#e5dacb] pt-1 font-bold"><span>Total Dr</span><span>{money(row.debitTotal)}</span></div></div></td><td className="p-3"><div className="grid gap-1">{row.credits.map((line, index) => <div key={`${row.id}-cr-${index}`} className="flex flex-wrap justify-between gap-2"><span>{line.account}</span><b className="whitespace-nowrap">{money(line.amount)}</b></div>)}<div className="mt-1 flex justify-between gap-2 border-t border-[#e5dacb] pt-1 font-bold"><span>Total Cr</span><span>{money(row.creditTotal)}</span></div></div></td></tr>)}</tbody></table>{!accountingVoucherRows.length && <p className="p-5 text-center text-xs text-muted">Confirmed sales and documented Artist payouts will post here automatically.</p>}</div></div>
          </div>
        </section>}
        {payoutModalRow && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="payout-proof-title"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-[#D9C6A6] bg-[#FAF6F0] p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Owner payout settlement</p><h2 id="payout-proof-title" className="mt-1 font-display text-2xl">Record payment</h2><p className="mt-1 text-xs text-muted">{payoutModalRow.artist_name} · {payoutModalRow.order_ref}</p></div><button type="button" className="rounded-full p-2 hover:bg-[#eee6db]" onClick={() => setPayoutModalRow(null)} aria-label="Close payout modal"><X size={18}/></button></div><div className="mt-4 rounded-xl bg-white p-4 text-sm"><p className="flex justify-between"><span>Artist share due</span><b>{money(payoutModalRow.artist_payout)}</b></p><p className="mt-1 flex justify-between"><span>Already paid</span><b>{money(payoutAlreadyPaid(payoutModalRow))}</b></p><p className="mt-2 flex justify-between border-t pt-2"><span>Remaining pending</span><b>{money(payoutRemaining(payoutModalRow))}</b></p></div><p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Standard payout cycle: 48 hours after delivery is confirmed. This is an informational timing note only; the Host may record a completed transfer immediately when payment proof is attached.</p><form onSubmit={submitPayoutPayment} className="mt-5 grid gap-4"><label className="label">Amount Paid (₹)<input className="field mt-1" type="number" required min="0.01" max={payoutRemaining(payoutModalRow)} step="0.01" value={payoutPayment.amount} onChange={(e) => setPayoutPayment({ ...payoutPayment, amount: e.target.value })}/><small className="text-muted">Pre-filled with the remaining due. Enter a smaller amount to record a partial payment.</small></label><label className="label">Transaction Reference / UTR (optional)<input className="field mt-1" value={payoutPayment.utr} maxLength={150} onChange={(e) => setPayoutPayment({ ...payoutPayment, utr: e.target.value })} placeholder="UPI / NEFT transaction reference"/></label><label className="label">Payment Proof Photo / Receipt <span className="text-red-700">(required)</span><input className="mt-2 block w-full text-xs" type="file" required accept="image/jpeg,image/png,image/webp,image/avif,.pdf,application/pdf" onChange={(e) => setPayoutPayment({ ...payoutPayment, proof: e.target.files?.[0] || null })}/><small className="text-muted">JPG, PNG, WEBP, AVIF or PDF · maximum 10 MB</small></label><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setPayoutModalRow(null)}>Cancel</button><button disabled={busy || !payoutPayment.proof || Number(payoutPayment.amount) <= 0 || Number(payoutPayment.amount) > payoutRemaining(payoutModalRow)} className="btn-primary">{busy ? 'Saving payment…' : 'Save Payment + Proof'}</button></div></form></section></div>}
        <p className="mt-12 text-center text-[9px] uppercase tracking-[.2em] text-muted">Artiste · Owner dashboard</p>
      </div>
    </main>
  );
}
