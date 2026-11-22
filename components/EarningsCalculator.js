"use client";
import { useState } from 'react';
import { IndianRupee, Sparkles } from 'lucide-react';
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
export default function EarningsCalculator({ creatorRole = 'Painter' }) {
  const [price, setPrice] = useState('10000');
  const photographer = creatorRole === 'Photographer';
  const feeRate = photographer ? 0.05 : 0.02;
  const payoutRate = 1 - feeRate;
  const amount = Math.max(0, Number(price) || 0);
  const fee = Math.round(amount * feeRate * 100) / 100;
  const payout = Math.max(0, amount - fee);
  const pct = (value) => `${Math.round(value * 100)}%`;
  return <section className="rounded-[28px] border border-[#d9c6ae] bg-[#f4e8d9] p-6 shadow-soft md:p-8">
    <div className="grid gap-7 md:grid-cols-[1fr_.9fr] md:items-center">
      <div><p className="eyebrow flex items-center gap-2"><Sparkles size={13}/> Private creator earnings calculator</p><h2 className="mt-3 max-w-xl font-display text-4xl leading-tight md:text-5xl">Your creator payout — <em className="font-normal text-clay">Keep {pct(payoutRate)} of Every Sale</em></h2><p className="mt-4 max-w-xl text-sm leading-7 text-[#6f6256]">Your {photographer ? 'Photographer' : 'Painter / Artist'} platform fee is {pct(feeRate)} of the artwork sale value. Shipping is calculated separately.</p><p className="mt-4 text-[10px] font-bold uppercase tracking-[.17em] text-clay">Private dashboard estimate · No shipping deduction here</p></div>
      <div className="rounded-3xl border border-white/80 bg-[#F3ECE1] p-5 md:p-6"><label className="label">Your artwork sale price (INR)<div className="mt-2 flex items-center rounded-xl border border-[#D9C6A6] bg-white px-4"><IndianRupee size={22} className="mr-2 text-clay"/><input className="w-full bg-transparent py-3 font-display text-3xl outline-none" type="number" min="0" step="100" value={price} onChange={(e) => setPrice(e.target.value)} /></div></label><div className="mt-5 rounded-2xl bg-[#263832] p-5 text-white"><p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#d5b99a]">Your net payout · {pct(payoutRate)}</p><p className="mt-1 font-display text-4xl">{money(payout)}</p><div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-xs"><span className="text-[#e3d6c8]">Platform fee · {pct(feeRate)}</span><b>{money(fee)}</b></div></div><p className="mt-3 text-[10px] leading-5 text-muted">Illustrative estimate. Fee applies to artwork value, not separately collected shipping.</p></div>
    </div>
  </section>;
}
