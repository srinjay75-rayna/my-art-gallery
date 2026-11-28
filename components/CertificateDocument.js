"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, ShieldCheck } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

function dateTime(value) { return value ? new Date(value).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }) : '—'; }
export default function CertificateDocument() {
  const params = useParams();
  const orderId = String(params?.orderId || '');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let token = '';
        try { const { data: sessionData } = await getBrowserSupabase().auth.getSession(); token = sessionData.session?.access_token || ''; } catch {}
        const response = await fetch(`/api/order-documents/${encodeURIComponent(orderId)}`, { cache: 'no-store', credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Certificate unavailable.');
        if (active) setData(result);
      } catch (err) { if (active) setError(err.message); }
      finally { if (active) setBusy(false); }
    }
    if (orderId) load();
    return () => { active = false; };
  }, [orderId]);
  if (busy) return <main className="paper-grain min-h-screen p-10 text-center">Preparing your Certificate of Authenticity…</main>;
  if (error || !data) return <main className="paper-grain min-h-screen p-8"><div className="mx-auto max-w-xl rounded-2xl bg-[#F3ECE1] p-8"><h1 className="font-display text-3xl">Certificate unavailable</h1><p className="mt-3 text-sm text-red-800">{error}</p><a href="/account" className="btn-secondary mt-5 inline-flex">Back to account</a></div></main>;
  const items = (data.items || []).filter((item) => item.print_lab_managed || item.creator_role === 'Photographer' || item.category === 'Photography');
  return <main className="paper-grain min-h-screen px-4 py-8 md:px-8"><div className="no-print mx-auto mb-5 flex max-w-4xl flex-wrap items-center justify-between gap-3"><a href={data.role === 'owner' ? '/studio-vault-owner' : data.role === 'artist' ? '/artist' : '/account'} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14}/> Back</a><button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-2"><Download size={14}/> Download / Print COA</button></div>
  <div className="mx-auto grid max-w-4xl gap-7">{items.map((item, index) => <article key={item.id || index} className="coa-sheet relative overflow-hidden border-[8px] border-double border-[#B38A45] bg-[#FFFCF2] p-7 text-[#30251B] shadow-2xl md:p-12"><div className="pointer-events-none absolute inset-3 border border-[#D5B975]"/><div className="relative text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#B38A45] font-display text-3xl text-[#9B7137]">A</div><p className="mt-4 text-[9px] font-bold uppercase tracking-[.3em] text-[#94703B]">Artiste · The Indian Art House</p><h1 className="mt-3 font-display text-4xl md:text-5xl">Certificate of Authenticity</h1><p className="mt-2 text-[10px] font-semibold uppercase tracking-[.25em] text-[#8D714B]">Gold-Sealed Provenance Dossier</p><div className="mx-auto my-6 h-px max-w-sm bg-[#C9A76C]"/><p className="text-xs uppercase tracking-widest text-[#8D714B]">This certifies that the following fine-art photograph is an authentic Artiste edition.</p><h2 className="mt-5 font-display text-3xl">{item.title}</h2><p className="mt-2 text-sm">by {item.artist_name || 'Artiste Photographer'}</p><div className="mx-auto mt-7 grid max-w-xl gap-3 rounded-xl border border-[#D7C293] bg-[#F8F0DF] p-5 text-left sm:grid-cols-2"><div><p className="text-[9px] uppercase tracking-widest text-[#94703B]">Collector Edition</p><p className="mt-1 font-display text-2xl">#{item.edition_number || '—'} of {item.edition_total || item.edition_limit || '—'}</p></div><div><p className="text-[9px] uppercase tracking-widest text-[#94703B]">Edition Grade</p><p className="mt-1 font-semibold">Grade {item.edition_grade || '—'} · {item.edition_grade_name}</p></div><div><p className="text-[9px] uppercase tracking-widest text-[#94703B]">Artwork Size</p><p className="mt-1 font-semibold">{item.edition_size || item.dimensions}</p></div><div><p className="text-[9px] uppercase tracking-widest text-[#94703B]">Substrate</p><p className="mt-1 text-xs leading-5">{item.substrate_specs || 'Hahnemühle archival substrate'}</p></div></div><div className="mt-7"><p className="text-[9px] uppercase tracking-[.2em] text-[#94703B]">Unique serial number</p><p className="mt-2 break-all font-mono text-lg font-bold tracking-wide">{item.coa_serial || item.certificate_id || 'Serial pending'}</p></div><div className="mx-auto mt-7 flex h-20 w-20 items-center justify-center rounded-full border-4 border-double border-[#B38A45] text-center text-[8px] font-bold uppercase tracking-widest text-[#9B7137]">Artiste<br/>Verified</div><p className="mt-6 text-xs text-[#75634B]">Issued for confirmed order {data.order.merchant_order_ref || data.order.id} · {dateTime(data.order.paid_at)}</p><p className="mt-6 text-[9px] uppercase tracking-widest text-[#94703B]">Permanent edition record · Master file retired at edition cap</p></div></article>)}
  {!items.length && <div className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-8 text-center"><h1 className="font-display text-3xl">No Photography Certificate</h1><p className="mt-2 text-sm text-muted">This order does not contain a confirmed Fine-Art Photography edition.</p></div>}</div>
  <style jsx global>{`@page { size: A4 portrait; margin: 10mm; } @media print { html, body { background: #fff !important; } .no-print { display:none !important; } main { padding:0 !important; background:#fff !important; } .coa-sheet { break-after:page; box-shadow:none !important; margin:0 !important; } }`}</style></main>;
}
