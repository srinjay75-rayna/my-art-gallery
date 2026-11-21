"use client";
import { useState } from 'react';
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
export default function EarningsCalculator() {
  const [price, setPrice] = useState('10000');
  const amount = Math.max(0, Number(price) || 0);
  const fee = Math.round(amount * 0.02 * 100) / 100;
  const payout = Math.max(0, amount - fee);
  return <section className="rounded-[28px] border border-[#d9c6ae] bg-[#f4e8d9] p-6 shadow-soft md:p-8">
    <div className="grid gap-7 md:grid-cols-[1fr_.9fr] md:items-center">
      <div><p className="eyebrow">An artist-first promise</p><h2 className="mt-3 max-w-xl font-display text-4xl leading-tight md:text-5xl">Exhibit &amp; Sell on Artiste — <em className="font-normal text-clay">Keep 98% of Every Sale</em></h2><p className="mt-4 max-w-xl text-sm leading-7 text-[#6f6256]">Only 2% platform fee on the artwork sale. You set your artwork price, keep 98%, and retain your artistic independence.</p><p className="mt-4 text-[10px] font-bold uppercase tracking-[.17em] text-clay">Transparent pricing · No hidden platform commission</p></div>
      <div className="rounded-3xl border border-white/80 bg-[#fffdf8] p-5 md:p-6"><label className="label">Your artwork sale price (INR)<div className="mt-2 flex items-center rounded-xl border border-[#ded6ca] bg-white px-4"><span className="mr-2 font-display text-2xl text-clay">₹</span><input className="w-full bg-transparent py-3 font-display text-3xl outline-none" type="number" min="0" step="100" value={price} onChange={(e) => setPrice(e.target.value)} /></div></label><div className="mt-5 rounded-2xl bg-[#28231f] p-5 text-white"><p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#d5b99a]">You earn · 98%</p><p className="mt-1 font-display text-4xl">{money(payout)}</p><div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-xs"><span className="text-[#e3d6c8]">Artiste fee · 2%</span><b>{money(fee)}</b></div></div><p className="mt-3 text-[10px] leading-5 text-muted">Illustrative estimate. Shipping is calculated separately and is not included in the platform fee base.</p></div>
    </div>
  </section>;
}
