import { NextResponse } from 'next/server';
import { cleanEditorialText, FALLBACK_CULTURAL_STORIES } from '@/lib/cultural-stories';

export const runtime = 'nodejs';
export const revalidate = 604800; // Refresh the public Journal at most once per week.

const MODEL = 'gemini-2.5-flash';
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
};

function normaliseFilter(value) {
  return ['Paintings', 'Photography', 'All Works'].includes(value) ? value : 'All Works';
}

function normaliseStories(value) {
  if (!Array.isArray(value)) return null;
  const stories = value.slice(0, 6).map((story, index) => {
    const paragraphs = Array.isArray(story?.paragraphs)
      ? story.paragraphs.map((p) => cleanEditorialText(p, 1300)).filter(Boolean).slice(0, 4)
      : [];
    if (paragraphs.length !== 4) return null;
    const hookHeadline = cleanEditorialText(story?.hookHeadline, 180);
    const teaser = cleanEditorialText(story?.teaser, 420);
    if (!hookHeadline || !teaser) return null;
    const collectionFilter = normaliseFilter(story?.collectorBridge?.collectionFilter);
    return {
      id: `journal-${index + 1}`,
      hookHeadline,
      teaser,
      paragraphs,
      collectorBridge: {
        label: cleanEditorialText(story?.collectorBridge?.label, 90) || 'Explore the collection',
        collectionFilter,
      },
    };
  });
  return stories.length === 6 && stories.every(Boolean) ? stories : null;
}

function fallbackResponse(reason = 'fallback') {
  return NextResponse.json(
    { stories: FALLBACK_CULTURAL_STORIES, source: 'Artiste Journal', fallback: true, reason },
    { headers: CACHE_HEADERS },
  );
}

export async function GET() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return fallbackResponse('gemini-key-not-configured');

  const now = new Date();
  const month = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
  const seasonContext = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(now);
  const prompt = `Create exactly six original, all-ages editorial essays for the Artiste Journal, an Indian fine-art marketplace magazine. Current Indian local month: ${month}. Month/season cue: ${seasonContext}. Refresh the editorial mix for this month and relevant Indian seasonal rhythms and festivals, but do not invent a festival date, current event, award, exhibition, artist attribution, quotation or historical fact. Keep history accurate and distinguish traditions rather than blending them.

Cover a balanced mix of: the Bengal School; Kalighat painting; Madhubani / Mithila traditions; Rajput and Mughal miniature painting traditions; Indian fine-art photography and its print/edition choices; and living with Indian art / styling a home wall. Across the six stories, make room for the current month, Indian seasons and festival customs where genuinely relevant, without making the stories depend on a specific date. Mention global recognition of Indian art only in broad, verifiable terms; do not invent rankings, awards or sales figures.

Each story must contain:
- hookHeadline: a curiosity-sparking editorial headline (not clickbait).
- teaser: a clean plain-text summary, 1–2 sentences.
- paragraphs: exactly four rich, vivid, coherent storytelling paragraphs, suitable for all ages, about 45–80 words each.
- collectorBridge: an object with a warm button label and collectionFilter. collectionFilter must be exactly one of "Paintings", "Photography", or "All Works". Use Photography for photography stories, Paintings for painting traditions, and All Works for interiors / broader collector stories.

Output only valid JSON matching this shape:
{"stories":[{"hookHeadline":"...","teaser":"...","paragraphs":["...","...","...","..."],"collectorBridge":{"label":"...","collectionFilter":"Paintings"}}]}
No markdown, no HTML, no HTML entities, no external links, no source links, no adverts, no product claims, and no text outside the JSON.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.82,
          maxOutputTokens: 5200,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              stories: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    hookHeadline: { type: 'STRING' },
                    teaser: { type: 'STRING' },
                    paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
                    collectorBridge: {
                      type: 'OBJECT',
                      properties: {
                        label: { type: 'STRING' },
                        collectionFilter: { type: 'STRING', enum: ['Paintings', 'Photography', 'All Works'] },
                      },
                      required: ['label', 'collectionFilter'],
                    },
                  },
                  required: ['hookHeadline', 'teaser', 'paragraphs', 'collectorBridge'],
                },
              },
            },
            required: ['stories'],
          },
        },
      }),
      next: { revalidate: 604800 },
      signal: AbortSignal.timeout(35000),
    });

    const result = await response.json().catch(() => ({}));
    const rawText = result?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!response.ok || !rawText) {
      console.warn('Artiste Journal Gemini fallback:', response.status, result?.error?.message || 'No generated content');
      return fallbackResponse('generation-unavailable');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    } catch {
      console.warn('Artiste Journal returned invalid JSON; using curated stories.');
      return fallbackResponse('invalid-generated-json');
    }

    const stories = normaliseStories(parsed?.stories);
    if (!stories) {
      console.warn('Artiste Journal output did not meet the six-story format; using curated stories.');
      return fallbackResponse('incomplete-generated-stories');
    }

    return NextResponse.json(
      { stories, source: 'Artiste Journal · Gemini', month, fallback: false },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.warn('Artiste Journal fallback in use:', error?.message || error);
    return fallbackResponse('generation-error');
  }
}
