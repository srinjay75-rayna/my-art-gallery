"use client";

import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, CalendarDays, Feather, X } from 'lucide-react';
import { FALLBACK_CULTURAL_STORIES } from '@/lib/cultural-stories';

export default function CulturalFeed({ onExploreCollection }) {
  const [stories, setStories] = useState(FALLBACK_CULTURAL_STORIES);
  const [source, setSource] = useState('Artiste Journal');
  const [activeStory, setActiveStory] = useState(null);

  useEffect(() => {
    let active = true;
    fetch('/api/cultural-feed')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not refresh the Journal.')))
      .then((data) => {
        if (!active || !Array.isArray(data.stories) || data.stories.length !== 6) return;
        setStories(data.stories);
        setSource(data.source || 'Artiste Journal');
      })
      .catch(() => {
        // Curated in-bundle essays remain visible when the API or network is unavailable.
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!activeStory) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') setActiveStory(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeStory]);

  function exploreCollection(story) {
    const filter = story?.collectorBridge?.collectionFilter || 'All Works';
    setActiveStory(null);
    onExploreCollection?.(filter);
  }

  return (
    <>
      <section id="journal" className="mx-auto max-w-7xl scroll-mt-28 px-5 pb-20 pt-3 md:px-10">
        <div className="relative overflow-hidden rounded-[30px] border border-[#D9C6A6] bg-[#F3ECE1] p-6 md:p-10">
          <div className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full border border-[#C69C6D]/45" />
          <div className="relative mb-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow flex items-center gap-2"><BookOpen size={13}/> The Artiste Journal · {source}</p>
              <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-[#263832] md:text-5xl">Culture, History &amp; <em className="font-normal text-[#B85D3B]">Living With Art.</em></h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#6F7168]">A thoughtful reading room for Indian art heritage, independent makers, visual culture and the art of making a home.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#C69C6D]/70 bg-[#FAF6F0] px-4 py-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#6B665C]"><Feather size={13}/> Six stories · Refreshed weekly</span>
          </div>
          <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stories.map((story, index) => (
              <article key={story.id || `${story.hookHeadline}-${index}`} className="group flex min-h-[250px] flex-col rounded-2xl border border-[#D9C6A6]/75 bg-[#FAF6F0] p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(38,56,50,.10)]">
                <div className="flex items-center justify-between gap-3 text-[9px] font-bold uppercase tracking-[.13em] text-[#927B5D]"><span>Art &amp; Culture</span><span className="inline-flex items-center gap-1"><CalendarDays size={11}/> {String(index + 1).padStart(2, '0')} / 06</span></div>
                <h3 className="mt-5 font-display text-2xl leading-snug text-[#263832]">{story.hookHeadline}</h3>
                <p className="mt-3 flex-1 text-xs leading-6 text-[#6F7168]">{story.teaser}</p>
                <button type="button" onClick={() => setActiveStory(story)} className="mt-5 inline-flex w-fit items-center gap-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#B85D3B] transition group-hover:gap-3">Read inside Artiste <ArrowUpRight size={13}/></button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {activeStory && (
        <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-5" onClick={() => setActiveStory(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="journal-reader-title" className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-[#D9C6A6] bg-[#FAF6F0] p-6 shadow-[0_24px_80px_rgba(20,30,25,.28)] md:p-10" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setActiveStory(null)} aria-label="Close article" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#D9C6A6] bg-[#F3ECE1] text-[#263832] transition hover:bg-white"><X size={18}/></button>
            <p className="eyebrow flex items-center gap-2"><BookOpen size={13}/> The Artiste Journal · A collector's reading room</p>
            <h2 id="journal-reader-title" className="mt-5 max-w-2xl pr-8 font-display text-4xl leading-tight text-[#263832] md:text-5xl">{activeStory.hookHeadline}</h2>
            <p className="mt-5 border-l-2 border-[#C69C6D] pl-4 text-sm italic leading-7 text-[#756B60]">{activeStory.teaser}</p>
            <div className="mt-7 space-y-5 text-sm leading-8 text-[#4F5C53]">
              {(activeStory.paragraphs || []).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
            <div className="mt-9 flex flex-wrap items-center justify-between gap-4 border-t border-[#D9C6A6]/70 pt-6">
              <span className="text-[9px] font-bold uppercase tracking-[.16em] text-[#8A7864]">Continue the story through art</span>
              <button type="button" onClick={() => exploreCollection(activeStory)} className="btn-primary">
                {activeStory.collectorBridge?.label || 'Explore the collection'} <ArrowUpRight size={15}/>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
