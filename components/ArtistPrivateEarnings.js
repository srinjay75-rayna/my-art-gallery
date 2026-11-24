"use client";
import { Package, Wallet } from 'lucide-react';
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
export default function ArtistPrivateEarnings({ ledger = [], isFoundingArtist = false, showLedger = true }) {
  const fallbackCommission = isFoundingArtist ? 0.20 : 0.30;
  const gross = ledger.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0);
  const totalFee = ledger.reduce((sum, row) => sum + Number(row.platform_fee ?? (Number(row.gross_amount || 0) * Number(row.commission_rate ?? fallbackCommission))), 0);
  const earnings = ledger.reduce((sum, row) => sum + Number(row.artist_payout ?? (Number(row.gross_amount || 0) * (1 - Number(row.commission_rate ?? fallbackCommission)))), 0);
  const paid = ledger.filter((row) => row.payout_status === 'Paid').reduce((sum, row) => sum + Number(row.artist_payout || 0), 0);
  const pending = Math.max(0, earnings - paid);
  const artistShare = isFoundingArtist ? 80 : 70;
  const platformShare = 100 - artistShare;
  return showLedger ? <section id="earnings" className="mt-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow flex items-center gap-2"><Wallet size={13}/> Private Creator earnings &amp; payouts</p><h2 className="mt-2 font-display text-3xl">Your sales &amp; net payout ledger</h2></div><span className="pill">Artist share {artistShare}% · Platform share {platformShare}%</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Gross artwork sales</p><p className="mt-2 font-display text-3xl">{money(gross)}</p></div>
      <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Platform share</p><p className="mt-2 font-display text-3xl">{money(totalFee)}</p></div>
      <div className="rounded-2xl border border-[#d9c6ae] bg-[#f4e8d9] p-5"><p className="eyebrow">Artist net payout</p><p className="mt-2 font-display text-3xl">{money(earnings)}</p></div>
      <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Pending payout</p><p className="mt-2 font-display text-3xl">{money(pending)}</p><small className="text-muted">Settled: {money(paid)}</small></div>
    </div>
    <div className="mt-4 overflow-x-auto rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Sale value','Platform share','Net receivable','Payout status','Payout availability','Date','Packing slip'].map((col) => <th className="p-4" key={col}>{col}</th>)}</tr></thead><tbody>{ledger.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref || row.order_id}</td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(row.platform_fee ?? (Number(row.gross_amount || 0) * Number(row.commission_rate ?? fallbackCommission)))}</td><td className="p-4 font-semibold text-clay">{money(row.artist_payout ?? (Number(row.gross_amount || 0) * (1 - Number(row.commission_rate ?? fallbackCommission))))}</td><td className="p-4">{row.payout_status || 'Pending'}</td><td className="p-4">{row.payout_available_at ? new Date(row.payout_available_at).toLocaleString('en-IN') : 'After Delivered + 48 hours'}</td><td className="p-4">{new Date(row.created_at).toLocaleDateString('en-IN')}</td><td className="p-4"><a className="action-btn inline-flex items-center gap-1" href={`/packing-slip/${row.order_id}`} target="_blank" rel="noreferrer"><Package size={12}/> Packing slip</a></td></tr>)}</tbody></table>{!ledger.length && <p className="p-8 text-center text-sm text-muted">Your paid artwork sales will appear here. Add verified bank / UPI details in Studio Profile before requesting settlement.</p>}</div>
    <p className="mt-3 text-[10px] leading-5 text-muted">Payout eligibility begins 48 hours after the courier marks the shipment Delivered. Bank transfers are processed manually after eligibility and verified payout details are available.</p>
  </section> : null;
}
