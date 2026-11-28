"use client";
import { useState } from 'react';
import { Award, X } from 'lucide-react';
export default function AchievementShowcase({ achievements = [], compact = false }) {
  const [activeImage, setActiveImage] = useState('');
  if (!Array.isArray(achievements) || !achievements.length) return null;
  return <>
    <div className={compact ? 'mt-3 flex flex-wrap gap-2' : 'mt-4 grid gap-3 sm:grid-cols-2'}>
      {achievements.map((entry) => <article key={entry.id} className={compact ? 'flex items-center gap-2 rounded-lg border border-[#D9C6A6] bg-white/70 p-2' : 'rounded-xl border border-[#D9C6A6] bg-white/70 p-3'}>
        <div className="flex min-w-0 items-start gap-2"><Award size={compact ? 14 : 17} className="mt-0.5 shrink-0 text-clay"/><div className="min-w-0"><p className="text-xs font-semibold">{entry.title} <span className="font-normal text-muted">· {entry.achievement_year}</span></p>{!compact && entry.description && <p className="mt-1 text-[11px] leading-5 text-muted">{entry.description}</p>}</div></div>
        {Array.isArray(entry.photo_urls) && entry.photo_urls.length > 0 && <div className="mt-2 flex gap-2">{entry.photo_urls.slice(0, 3).map((url, index) => <button key={`${entry.id}-${index}`} type="button" onClick={() => setActiveImage(url)} className="h-12 w-12 overflow-hidden rounded-lg border border-[#e2d6c5]"><img src={url} alt={`${entry.title} award photo ${index + 1}`} className="h-full w-full object-cover" loading="lazy"/></button>)}</div>}
      </article>)}
    </div>
    {activeImage && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveImage(''); }}><button type="button" aria-label="Close award photo" onClick={() => setActiveImage('')} className="absolute right-5 top-5 rounded-full bg-white p-2 text-ink"><X size={18}/></button><img src={activeImage} alt="Artist achievement" className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain"/></div>}
  </>;
}
