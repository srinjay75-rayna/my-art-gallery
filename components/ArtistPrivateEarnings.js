"use client";
import EarningsCalculator from '@/components/EarningsCalculator';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

export default function ArtistPrivateEarnings({ ledger = [], showLedger = true }) {
  const gross = ledger.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0);
  const totalFee = ledger.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0);
  const earnings = ledger.reduce((sum, row) => sum + Number(row.artist_payout || 0), 0);
  const paid = ledger.filter((row) => row.payout_status === 'Paid').reduce((sum, row) => sum + Number(row.artist_payout || 0), 0);
  const pending = Math.max(0, earnings - paid);

  return <>
    <div className="mt-7"><EarningsCalculator /></div>
    {showLedger && <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">Private Artist earnings &amp; payouts</p><h2 className="mt-2 font-display text-3xl">Your Artist ledger</h2></div>
        <span className="pill">Keep 98% · 2% platform fee</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5"><p className="eyebrow">Artwork sales</p><p className="mt-2 font-display text-3xl">{money(gross)}</p></div>
        <div className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5"><p className="eyebrow">Platform fee · 2%</p><p className="mt-2 font-display text-3xl">{money(totalFee)}</p></div>
        <div className="rounded-2xl border border-[#d9c6ae] bg-[#f4e8d9] p-5"><p className="eyebrow">Net Artist earnings · 98%</p><p className="mt-2 font-display text-3xl">{money(earnings)}</p></div>
        <div className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-5"><p className="eyebrow">Pending payout</p><p className="mt-2 font-display text-3xl">{money(pending)}</p><small className="text-muted">Paid: {money(paid)}</small></div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e5dccf] bg-[#fffdf8]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f0e9df] text-[10px] uppercase tracking-wider"><tr>{['Order','Sale value','Artiste fee','Artist payout','Payout status','Date'].map((col) => <th className="p-4" key={col}>{col}</th>)}</tr></thead>
          <tbody>{ledger.map((row) => <tr key={row.id} className="border-t border-[#eee6db]"><td className="p-4">{row.order_ref || row.order_id}</td><td className="p-4">{money(row.gross_amount)}</td><td className="p-4">{money(row.platform_fee)}</td><td className="p-4 font-semibold text-clay">{money(row.artist_payout)}</td><td className="p-4">{row.payout_status || 'Pending'}</td><td className="p-4">{new Date(row.created_at).toLocaleDateString('en-IN')}</td></tr>)}</tbody>
        </table>
        {!ledger.length && <p className="p-8 text-center text-sm text-muted">Your paid artwork sales will appear here. Payout status is tracked transparently; bank transfers are not automatic.</p>}
      </div>
    </section>}
  </>;
}
