import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 1800;

const FEED_URL = 'https://news.google.com/rss/search?q=Indian+art+history+OR+Indian+home+decor+OR+museum+exhibitions&hl=en-IN&gl=IN&ceid=IN:en';

const FALLBACK_STORIES = [
  {
    title: 'Miniature painting: stories held in a small frame',
    description: 'Explore the detail, symbolism and patient craft of India’s miniature painting traditions, and how a single work can become the soul of a room.',
    source: 'Artiste Journal',
    link: 'https://news.google.com/search?q=Indian+miniature+painting+history',
    publishedAt: null,
  },
  {
    title: 'Ajanta, Ellora and the enduring language of colour',
    description: 'A look at the visual imagination, pigments and narrative traditions that continue to inspire artists and thoughtful collectors.',
    source: 'Artiste Journal',
    link: 'https://news.google.com/search?q=Ajanta+Ellora+Indian+art+heritage',
    publishedAt: null,
  },
  {
    title: 'Living with art: bringing Indian craft into modern homes',
    description: 'From a quiet reading corner to a generous gallery wall, discover ways to make paintings, photographs and handcrafted objects feel at home.',
    source: 'Artiste Journal',
    link: 'https://news.google.com/search?q=Indian+art+home+decor+gallery+wall',
    publishedAt: null,
  },
  {
    title: 'Warli, Gond and the beauty of living traditions',
    description: 'Folk and tribal art traditions hold distinct relationships with landscape, memory and everyday life—each with a story worth preserving.',
    source: 'Artiste Journal',
    link: 'https://news.google.com/search?q=Warli+Gond+art+India+artists',
    publishedAt: null,
  },
];

let memoryCache = { expiresAt: 0, articles: null, source: 'fallback' };

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseRss(xml) {
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const seen = new Set();
  const results = [];

  for (const block of blocks) {
    const title = field(block, 'title');
    const link = field(block, 'link');
    const description = field(block, 'description');
    const source = field(block, 'source') || 'Google News';
    const publishedAt = field(block, 'pubDate');
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    results.push({
      title: title.replace(/\s+-\s+[^-]+$/, '').trim(),
      description: description.slice(0, 340),
      source,
      link,
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString() : null,
    });
    if (results.length >= 8) break;
  }

  return results;
}

export async function GET() {
  const now = Date.now();
  if (memoryCache.articles && memoryCache.expiresAt > now) {
    return NextResponse.json(
      { articles: memoryCache.articles, source: memoryCache.source, cached: true },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
    );
  }

  try {
    const response = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'ArtisteCultureFeed/1.0 (+https://news.google.com)' },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Google News RSS returned ${response.status}`);
    const articles = parseRss(await response.text());
    if (!articles.length) throw new Error('Google News RSS did not return any readable stories.');

    memoryCache = { articles, expiresAt: now + 30 * 60 * 1000, source: 'Google News' };
    return NextResponse.json(
      { articles, source: 'Google News', cached: false },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
    );
  } catch (error) {
    console.warn('Cultural feed fallback in use:', error.message);
    memoryCache = { articles: FALLBACK_STORIES, expiresAt: now + 10 * 60 * 1000, source: 'Artiste Journal' };
    return NextResponse.json(
      { articles: FALLBACK_STORIES, source: 'Artiste Journal', fallback: true },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } },
    );
  }
}
