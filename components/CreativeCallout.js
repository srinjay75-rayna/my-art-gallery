"use client";
import { useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

const blank = { full_name: '', email: '', phone: '', city: '', discipline: '', portfolio_url: '', showcase_vision: '' };
export default function CreativeCallout() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/creative-entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send your entry.');
      setMessage(data.message || 'Your entry has been received. Thank you.'); setForm(blank);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <section className="mx-auto max-w-7xl px-5 py-9 md:px-10"><div className="relative overflow-hidden rounded-[28px] border border-[#C7A46D] bg-[#EDE1D1] px-6 py-7 md:px-10 md:py-9"><div className="absolute -right-12 -top-16 h-56 w-56 rounded-full border border-[#C4A77E]/50"/><div className="relative grid gap-5 md:grid-cols-[1fr_auto] md:items-center"><div><p className="text-[9px] font-bold uppercase tracking-[.22em] text-[#916B45]">An open creative call · Artiste</p><h2 className="mt-3 max-w-3xl font-display text-3xl leading-tight text-[#263832] md:text-4xl">Not a photographer, not even a painter—but still consider yourself an artist? Please send your entries.</h2></div><button type="button" onClick={() => { setOpen(true); setError(''); setMessage(''); }} className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap">Send Your Entry <ArrowUpRight size={15}/></button></div></div></section>
    {open && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="creative-entry-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#FAF6F0] p-6 shadow-2xl md:p-8"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Open Creative Call</p><h3 id="creative-entry-title" className="mt-2 font-display text-3xl">Send your entry</h3><p className="mt-2 text-xs text-muted">Tell us about your creative practice and how you hope to be showcased.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close entry form" className="rounded-full p-2 hover:bg-[#eee3d4]"><X size={18}/></button></div>
      {message ? <p role="status" className="mt-5 rounded-xl bg-green-50 p-4 text-sm text-green-800">{message}</p> : <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2"><label className="label">Full Name<input className="field mt-1" required maxLength={120} value={form.full_name} onChange={(e) => update('full_name', e.target.value)}/></label><label className="label">Email<input className="field mt-1" type="email" required maxLength={180} value={form.email} onChange={(e) => update('email', e.target.value)}/></label><label className="label">Phone / WhatsApp<input className="field mt-1" type="tel" required maxLength={30} value={form.phone} onChange={(e) => update('phone', e.target.value)}/></label><label className="label">City<input className="field mt-1" required maxLength={100} value={form.city} onChange={(e) => update('city', e.target.value)}/></label><label className="label sm:col-span-2">Creative Discipline / Medium<input className="field mt-1" required maxLength={140} value={form.discipline} onChange={(e) => update('discipline', e.target.value)} placeholder="e.g. sculpture, music, craft, writing, performance"/></label><label className="label sm:col-span-2">Portfolio / Social Link (optional)<input className="field mt-1" type="url" maxLength={500} value={form.portfolio_url} onChange={(e) => update('portfolio_url', e.target.value)} placeholder="https://"/></label><label className="label sm:col-span-2">How would you like to showcase yourself on Artiste?<textarea className="field mt-1 min-h-28" required minLength={10} maxLength={2500} value={form.showcase_vision} onChange={(e) => update('showcase_vision', e.target.value)} placeholder="Share your vision, work, ideas and the kind of collaboration you have in mind."/></label>{error && <p role="alert" className="sm:col-span-2 text-xs text-red-700">{error}</p>}<button disabled={busy} className="btn-primary sm:col-span-2">{busy ? 'Submitting…' : 'Submit Creative Entry'}</button></form>}
    </section></div>}
  </>;
}
