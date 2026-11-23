"use client";
import EarningsCalculator from '@/components/EarningsCalculator';
import { Package, Wallet } from 'lucide-react';
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
export default function ArtistPrivateEarnings({ ledger = [], creatorRole = 'Painter', showLedger = true }) {
  const photographer = creatorRole === 'Photographer';
  const feeRate = photographer ? 10 : 15;
  const payoutRate = 100 - feeRate;
  const gross = ledger.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0);
  const totalFee = gross * (feeRate / 100);
  const earnings = Math.max(0, gross - totalFee);
  const paid = ledger.filter((row) => row.payout_status === 'Paid').reduce((sum, row) => sum + (Number(row.gross_amount || 0) * payoutRate / 100), 0);
  const pending = Math.max(0, earnings - paid);
  return <>
    <div className="mt-7"><EarningsCalculator creatorRole={creatorRole} /></div>
    {showLedger && <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow flex items-center gap-2"><Wallet size={13}/> Private Creator earnings &amp; payouts</p><h2 className="mt-2 font-display text-3xl">Your sales &amp; net payout ledger</h2></div><span className="pill">Keep {payoutRate}% · {feeRate}% platform fee</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Gross artwork sales</p><p className="mt-2 font-display text-3xl">{money(gross)}</p></div>
        <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Platform fee · {feeRate}%</p><p className="mt-2 font-display text-3xl">{money(totalFee)}</p></div>
        <div className="rounded-2xl border border-[#d9c6ae] bg-[#f4e8d9] p-5"><p className="eyebrow">Net receivable · {payoutRate}%</p><p className="mt-2 font-display text-3xl">{money(earnings)}</p></div>
        <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><p className="eyebrow">Pending payout</p><p className="mt-2 font-display text-3xl">{money(pending)}</p><small className="text-muted">Settled: {money(paid)}</small></div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1]"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Sale value','Platform fee','Net receivable','Payout status','Date','Packing slip'].map((col) => <th className="p-4" key={col}>{col}</th>)}</tr></thead><tbody>{ledger.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref || row.order_id}</td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(Number(row.gross_amount || 0) * feeRate / 100)} ({feeRate}%)</td><td className="p-4 font-semibold text-clay">{money(Number(row.gross_amount || 0) * payoutRate / 100)}</td><td className="p-4">{row.payout_status || 'Pending'}</td><td className="p-4">{new Date(row.created_at).toLocaleDateString('en-IN')}</td><td className="p-4"><div className="flex flex-wrap gap-2"><a className="action-btn inline-flex items-center gap-1" href={`/packing-slip/${row.order_id}`} target="_blank" rel="noreferrer"><Package size={12}/> Packing slip</a></div></td></tr>)}</tbody></table>{!ledger.length && <p className="p-8 text-center text-sm text-muted">Your paid artwork sales will appear here. Payout status is tracked transparently; bank transfers are not automatic.</p>}</div>
    </section>}
  </>;
}
