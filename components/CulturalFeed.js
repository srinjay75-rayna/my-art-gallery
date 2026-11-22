"use client";

import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, CalendarDays, Feather } from 'lucide-react';

const starterStories = [
  { title: 'Miniature painting: stories held in a small frame', description: 'Explore the detail, symbolism and patient craft of India’s miniature painting traditions.', source: 'Artiste Journal', link: 'https://news.google.com/search?q=Indian+miniature+painting+history', publishedAt: null },
  { title: 'Ajanta, Ellora and the enduring language of colour', description: 'A look at visual imagination, pigments and narrative traditions that continue to inspire artists.', source: 'Artiste Journal', link: 'https://news.google.com/search?q=Ajanta+Ellora+Indian+art+heritage', publishedAt: null },
  { title: 'Living with art: bringing Indian craft into modern homes', description: 'Discover ways to make paintings, photographs and handcrafted objects feel at home.', source: 'Artiste Journal', link: 'https://news.google.com/search?q=Indian+art+home+decor+gallery+wall', publishedAt: null },
];

function displayDate(value) {
  if (!value) return 'Curated reading';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Latest stories' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CulturalFeed() {
  const [articles, setArticles] = useState(starterStories);
  const [source, setSource] = useState('Artiste Journal');

  useEffect(() => {
    let active = true;
    fetch('/api/cultural-feed', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not refresh the Journal.')))
      .then((data) => {
        if (!active || !Array.isArray(data.articles) || !data.articles.length) return;
        setArticles(data.articles);
        setSource(data.source || 'Google News');
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <section id="journal" className="mx-auto max-w-7xl scroll-mt-28 px-5 pb-20 md:px-10">
      <div className="relative overflow-hidden rounded-[30px] border border-[#D9C6A6] bg-[#F3ECE1] p-6 md:p-10">
        <div className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full border border-[#C69C6D]/45" />
        <div className="relative mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow flex items-center gap-2"><BookOpen size={13}/> The Artiste Journal · {source}</p>
            <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-[#263832] md:text-5xl">Culture, History &amp; <em className="font-normal text-[#B85D3B]">Living With Art.</em></h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#6F7168]">A thoughtful reading room for Indian art heritage, independent makers, visual culture and the art of making a home.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#C69C6D]/70 bg-[#FAF6F0] px-4 py-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#6B665C]"><Feather size={13}/> Notes for collectors</span>
        </div>
        <div className="relative grid gap-4 md:grid-cols-3">
          {articles.slice(0, 3).map((article, index) => (
            <article key={`${article.link}-${index}`} className="group flex min-h-[230px] flex-col rounded-2xl border border-[#D9C6A6]/75 bg-[#FAF6F0] p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(38,56,50,.10)]">
              <div className="flex items-center justify-between gap-3 text-[9px] font-bold uppercase tracking-[.13em] text-[#927B5D]"><span>{article.source || 'Art & Culture'}</span><span className="inline-flex items-center gap-1"><CalendarDays size={11}/>{displayDate(article.publishedAt)}</span></div>
              <h3 className="mt-5 font-display text-2xl leading-snug text-[#263832]">{article.title}</h3>
              <p className="mt-3 flex-1 text-xs leading-6 text-[#6F7168]">{article.description || 'A story from the wider world of Indian art, makers and meaningful spaces.'}</p>
              <a href={article.link} target="_blank" rel="noreferrer" className="mt-5 inline-flex w-fit items-center gap-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#B85D3B] transition group-hover:gap-3">Read the story <ArrowUpRight size={13}/></a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
