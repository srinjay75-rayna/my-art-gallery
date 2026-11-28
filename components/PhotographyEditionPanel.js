"use client";
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BadgeCheck, ShieldCheck, X } from 'lucide-react';
import { PHOTOGRAPHY_GRADES, calculatePhotographyGradePrices, getPrintLabCosts } from '@/lib/photography-pricing';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));

export default function PhotographyEditionPanel({ painting, onAdd, onBuy }) {
  const [selectedGrade, setSelectedGrade] = useState(1);
  const [editionCounts, setEditionCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', inquiry: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const prices = useMemo(() => calculatePhotographyGradePrices(painting.artist_fee_grade_1, getPrintLabCosts()), [painting.artist_fee_grade_1]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/photography/editions?paintingId=${encodeURIComponent(painting.id)}`, { cache: 'no-store' })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || 'Edition availability is temporarily unavailable.');
        if (!active) return;
        const next = Object.fromEntries((data.editions || []).map((row) => [Number(row.grade), { limit: Number(row.edition_limit), sold: Number(row.sold_count) }]));
        setEditionCounts(next);
        const currentlyAvailable = PHOTOGRAPHY_GRADES.find((grade) => Number(next[grade.grade]?.sold || 0) < Number(next[grade.grade]?.limit || grade.edition));
        if (currentlyAvailable) setSelectedGrade((current) => {
          const row = next[current];
          return row && row.sold >= row.limit ? currentlyAvailable.grade : current;
        });
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [painting.id]);

  const selected = PHOTOGRAPHY_GRADES.find((grade) => grade.grade === selectedGrade) || PHOTOGRAPHY_GRADES[0];
  const selectedPrice = prices.find((grade) => grade.grade === selectedGrade) || null;
  const remaining = (grade) => Math.max(0, Number(editionCounts[grade.grade]?.limit ?? grade.edition) - Number(editionCounts[grade.grade]?.sold || 0));
  const soldOut = remaining(selected) <= 0;

  async function submitConcierge(event) {
    event.preventDefault(); setSubmitting(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/photography/concierge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ painting_id: painting.id, ...form, inquiry: form.inquiry || 'I would like to discuss the Grade V Royal 1-of-1 original and bespoke architectural commission.' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit your private inquiry.');
      setNotice(data.message || 'Your private concierge inquiry has been recorded.');
      setForm({ full_name: '', email: '', phone: '', inquiry: '' });
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  const acquireItem = () => ({
    ...painting,
    price: selectedPrice?.collector_price ?? painting.price,
    edition_grade: selected.grade,
    edition_grade_name: selected.name,
    edition_size: selected.size,
    edition_limit: selected.edition,
    substrate_specs: selected.substrate,
    framing_specs: selected.substrate,
    photography_artist_fee: selectedPrice?.artist_fee ?? 0,
    photography_lab_cost: selectedPrice?.lab_cost ?? 0,
    print_lab_managed: true,
  });

  return <section className="mt-5 space-y-4" aria-label="Fine-Art Photography edition selector">
    <div className="rounded-2xl border border-[#C7A46D] bg-[#FAF6F0] p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#9A6A3C]">The Artiste Collector Editions</p><h3 className="mt-1 font-display text-2xl">Choose Your Edition</h3></div><span className="rounded-full border border-[#D8C29D] px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#72583D]">4 museum grades</span></div>
      <div className="mt-4 grid gap-3">
        {PHOTOGRAPHY_GRADES.map((grade, index) => {
          const price = prices[index]; const left = remaining(grade); const sold = left === 0;
          return <button key={grade.grade} type="button" disabled={sold} onClick={() => setSelectedGrade(grade.grade)} className={`rounded-xl border p-3 text-left transition ${selectedGrade === grade.grade ? 'border-[#A97845] bg-[#efe3d0] shadow-sm' : 'border-[#e2d6c5] bg-white/70 hover:border-[#bd9a6b]'} ${sold ? 'cursor-not-allowed opacity-75' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-[9px] font-bold uppercase tracking-[.16em] text-[#9A6A3C]">{grade.label}</span><span className="text-xs font-bold text-ink">{sold ? 'Edition Sold Out — Master File Retired' : `${left} / ${grade.edition} remaining`}</span></div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><span className="font-display text-xl">{grade.name}</span><b className="text-lg text-clay">{price ? money(price.collector_price) : 'Price unavailable'}</b></div>
            <p className="mt-1 text-[10px] font-semibold tracking-wide text-muted">{grade.size} · EDITION OF {grade.edition}</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">{grade.substrate}</p>
            <p className="mt-2 text-xs leading-5 text-[#65584B]">{grade.copy}</p>
            {price && <p className="mt-2 text-[10px] text-muted">Artist fee {money(price.artist_fee)} · Print lab &amp; framing {money(price.lab_cost)}</p>}
          </button>;
        })}
      </div>
      {error && !conciergeOpen && <p role="status" className="mt-3 text-xs text-red-700">{error}</p>}
      {loading && <p className="mt-3 text-[10px] text-muted">Checking live edition availability…</p>}
      <button type="button" disabled={loading || soldOut || !selectedPrice} onClick={() => onBuy(acquireItem())} className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2">Acquire Work · {selected.label} <ArrowUpRight size={15}/></button>
      <button type="button" onClick={() => onAdd(acquireItem())} disabled={loading || soldOut || !selectedPrice} className="btn-secondary mt-2 w-full">Add selected edition to cart</button>
      <button type="button" onClick={() => { setConciergeOpen(true); setError(''); setNotice(''); }} className="mt-4 block w-full text-center text-[10px] font-bold uppercase tracking-[.13em] text-[#966A40] underline decoration-[#C8AA83] underline-offset-4">GRADE V (OPTIONAL) — The Royal 1-of-1 Original &amp; Bespoke Architectural Commission • UNIQUE 1 OF 1 / CUSTOM SCALE</button>
      <p className="mt-2 text-center text-[10px] leading-5 text-muted">Reserved for serious patrons acquiring an irreplaceable original work or commissioning a bespoke monumental scale above 30×45″, custom-framed with dedicated air-crated white-glove delivery and brass-embossed provenance dossier.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-3">
      <article className="rounded-xl border border-[#D9C6A6] bg-white/70 p-3"><ShieldCheck size={18} className="text-clay"/><p className="mt-2 text-[9px] font-bold uppercase tracking-wider">100-Year Archival Permanence</p><p className="mt-1 text-[10px] leading-5 text-muted">Certified German Hahnemühle acid-free cotton &amp; etching substrates printed in 12-color museum pigment inks—never commercial dye prints.</p></article>
      <article className="rounded-xl border border-[#D9C6A6] bg-white/70 p-3"><BadgeCheck size={18} className="text-clay"/><p className="mt-2 text-[9px] font-bold uppercase tracking-wider">White-Glove Provenance Dossier &amp; Certificate of Authenticity</p><p className="mt-1 text-[10px] leading-5 text-muted">Every photograph acquisition includes a gold-sealed Certificate of Authenticity, matching reverse serial plaque, and 100% cotton handling gloves.</p></article>
      <article className="rounded-xl border border-[#D9C6A6] bg-white/70 p-3"><ShieldCheck size={18} className="text-clay"/><p className="mt-2 text-[9px] font-bold uppercase tracking-wider">Permanent Edition Lock</p><p className="mt-1 text-[10px] leading-5 text-muted">Strict caps 30 / 20 / 10 / 5 per artwork size. Once an edition sells out, the master file is permanently retired and never reprinted.</p></article>
    </div>

    {conciergeOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConciergeOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="grade-v-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-[#C7A46D] bg-[#FAF6F0] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Private Patron Enquiry</p><h3 id="grade-v-title" className="mt-2 font-display text-3xl">The Royal 1-of-1</h3><p className="mt-2 text-xs leading-5 text-muted">A member of the Artiste Host team will contact you regarding a bespoke original or monumental commission.</p></div><button type="button" onClick={() => setConciergeOpen(false)} aria-label="Close concierge inquiry" className="rounded-full p-2 hover:bg-[#eee3d4]"><X size={18}/></button></div>
      {notice ? <p role="status" className="mt-5 rounded-xl bg-green-50 p-4 text-sm text-green-800">{notice}</p> : <form onSubmit={submitConcierge} className="mt-5 grid gap-3"><label className="label">Full Name<input className="field mt-1" required maxLength={120} value={form.full_name} onChange={(e) => setForm((current) => ({ ...current, full_name: e.target.value }))}/></label><label className="label">Email<input type="email" className="field mt-1" required maxLength={180} value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}/></label><label className="label">Phone / WhatsApp<input type="tel" className="field mt-1" maxLength={30} value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}/></label><label className="label">Your vision / commission details<textarea className="field mt-1 min-h-24" maxLength={2500} value={form.inquiry} onChange={(e) => setForm((current) => ({ ...current, inquiry: e.target.value }))} placeholder="Share your preferred scale, framing, space or commission idea."/></label>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}<button disabled={submitting} className="btn-primary">{submitting ? 'Sending enquiry…' : 'Send Private Enquiry'}</button></form>}
    </section></div>}
  </section>;
}
