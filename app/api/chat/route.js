import { NextResponse } from 'next/server';
import siteConfig from '@/lib/siteConfig';
import { getPublicServerSupabaseClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 1800;
const rateWindow = 60_000;
const rateLimit = new Map();

function fallbackAnswer(message, history = []) {
  const question = String(message || '').toLowerCase();
  const recent = history.slice(-4).map((entry) => String(entry.text || '')).join(' ').toLowerCase();
  const followUp = /^(what about|how about|and|also|can i|what if|how does it|how long|how much|is that|does that|will it|can you explain)\b/i.test(question);
  const matches = (pattern) => pattern.test(question) || (followUp && pattern.test(recent));
  const contact = `For personal assistance, contact ${siteConfig.supportEmail} or WhatsApp +${siteConfig.whatsappNumber}.`;
  if (matches(/commission|platform fee|payout|earning|net receivable/)) return `Creator commission and payout details are private. Please sign in to the Creator Portal at /artist and open your earnings dashboard to view your role-specific statement. Shipping is accounted for separately. ${contact}`;
  if (matches(/photo|photograph|photography|print|edition/)) return `Artiste has a curated Fine-Art Photography wing alongside its original paintings. Each listing can show its photographic process, dimensions, edition and print details. Explore /photography for available works. ${contact}`;
  if (matches(/bill|invoice|receipt|gst|tax/)) return `After a successful paid order, the Customer can open My Orders and choose “View / Download Official Bill (PDF)”. Artiste issues a non-GST Bill of Supply with the order items, shipping breakdown and Razorpay payment reference. ${contact}`;
  if (matches(/ship|deliver|dispatch|courier|pin code|pincode|tracking|awb/)) return `Delivery quotes are calculated live at checkout from the creator studio pickup PIN (Point A) to the Customer delivery PIN (Point B), using Shiprocket where available. Choose a quoted courier for each studio in the basket. After payment, shipment and AWB details appear in My Orders as dispatch is booked. ${contact}`;
  if (matches(/creator|photographer|painter|artist|onboard|apply|sell|list|upload|join/)) return `Painters and Fine-Art Photographers use the same creator portal at /artist. Sign in using the 6-digit email verification code or your account password, select Painter or Photographer in your profile, add your studio and payout details, and publish works after the required profile checks. ${contact}`;
  if (matches(/payment|razorpay|upi|card|bank/)) return `Checkout payments are processed through Razorpay. The available payment methods depend on Razorpay and your bank at checkout. Never share your UPI PIN, card PIN or banking password in chat. ${contact}`;
  if (matches(/damage|broken|crack|unbox|packag|return|refund/)) return `Please keep the original packaging and take clear photos. For transit damage, preserve a continuous unboxing video and contact Artiste Support promptly with your order reference so the case can be reviewed under the published Shipping & Returns policy. ${contact}`;
  if (matches(/support|contact|email|whatsapp|phone/)) return `Artiste Support: ${siteConfig.supportEmail} · ${siteConfig.phoneNumber} · WhatsApp +${siteConfig.whatsappNumber}. ${contact}`;
  return `I can help with original paintings, Fine-Art Photography, creator onboarding, Shiprocket delivery quotes, Razorpay payments, Bills of Supply and order support. Could you share a little more detail about what you need? For a person, ${contact}`;
}


async function getLiveGalleryContext() {
  try {
    const supabase = getPublicServerSupabaseClient();
    const { data, error } = await supabase.from('paintings')
      .select('title,category,medium,dimensions,price,artist_name,stock_quantity,edition_details,print_details')
      .eq('is_approved', true).eq('is_sold', false).gt('stock_quantity', 0)
      .order('created_at', { ascending: false }).limit(40);
    if (error) throw error;
    return (data || []).map((work) => ({
      title: work.title,
      artForm: work.category === 'Photography' ? 'Fine-Art Photography' : 'Original Painting',
      creatorStudio: work.artist_name || 'Artiste Studio',
      medium: work.medium,
      dimensions: work.dimensions,
      priceINR: Number(work.price || 0),
      availableStockAtRequestTime: Number(work.stock_quantity || 0),
      editionDetails: work.edition_details || '',
      printDetails: work.print_details || '',
    }));
  } catch (error) {
    console.error('Concierge gallery context unavailable:', error.message);
    return [];
  }
}

function limited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.start > rateWindow) {
    rateLimit.set(ip, { start: now, count: 1 });
    if (rateLimit.size > 5000) {
      for (const [key, value] of rateLimit) if (now - value.start > rateWindow) rateLimit.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > 18;
}

export async function POST(request) {
  try {
    const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 80);
    if (limited(ip)) return NextResponse.json({ error: 'Please pause for a moment before asking another question.' }, { status: 429 });
    const body = await request.json();
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages = rawMessages.slice(-MAX_MESSAGES).map((entry) => ({
      role: entry?.from === 'bot' || entry?.role === 'model' ? 'model' : 'user',
      text: String(entry?.text ?? entry?.content ?? '').trim().slice(0, MAX_MESSAGE_CHARS),
    })).filter((entry) => entry.text);
    const latestUser = [...messages].reverse().find((entry) => entry.role === 'user');
    if (!latestUser?.text) return NextResponse.json({ error: 'Please enter a question.' }, { status: 400 });

    const fallback = fallbackAnswer(latestUser.text, messages.filter((entry) => entry.role === 'user'));
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return NextResponse.json({ reply: fallback, mode: 'fallback' });

    const model = String(process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim().replace(/[^a-zA-Z0-9._-]/g, '');
    const galleryContext = await getLiveGalleryContext();
    const systemInstruction = `You are Artiste Concierge, the official customer and creator support assistant for Artiste, an Indian marketplace. Be warm, concise, practical and conversational. Ask one useful follow-up question when needed. Never invent order status, stock, a live courier quote, legal/tax advice, payment confirmation, refunds, delivery dates or policies. You cannot access a specific customer's order or live Shiprocket pricing; explain that actual Point-A to Point-B Shiprocket options and rates are fetched at checkout after the product and delivery PIN are known. Explain Artiste accurately: original paintings are the primary gallery; Fine-Art Photography is a curated secondary wing; creators use one /artist portal and choose Painter (displayed as Artist) or Photographer; role-specific commission and payout figures are confidential and must never be disclosed in this public chat; direct logged-in creators to the Creator Dashboard. Never disclose or link private owner-only routes, credentials or internal management paths. If asked publicly, explain only that role-specific statements are visible after sign-in; shipping is separate from artwork commission. Customer payments are processed through Razorpay. Paid orders receive a non-GST Bill of Supply / Retail Invoice accessible from My Orders. Creator listings can have stock quantity and are marked sold out only when stock reaches zero. Do not ask customers to disclose card numbers, OTPs, UPI PINs, passwords or bank credentials. For support escalation, give ${siteConfig.supportEmail}, ${siteConfig.phoneNumber}, WhatsApp +${siteConfig.whatsappNumber}. Company address: ${siteConfig.headOfficeAddress}. Business status: ${siteConfig.gstStatus}. Policy pages: /shipping-returns, /account, /artist, /photography. Use this live request-time public gallery snapshot for artwork titles, formats, listed prices and stock only; do not promise an item is still available because stock can change at checkout. If the snapshot is empty or unavailable, direct users to /#gallery or /photography rather than inventing works. Live gallery snapshot (JSON): ${JSON.stringify(galleryContext)}.`;
    const contents = messages.map((entry) => ({ role: entry.role, parts: [{ text: entry.text }] }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { maxOutputTokens: 450 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(18000),
    });
    const result = await response.json().catch(() => ({}));
    const generated = result?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!response.ok || !generated) {
      console.error('Gemini Concierge request failed:', response.status, result?.error?.message || 'No text response');
      return NextResponse.json({ reply: fallback, mode: 'fallback' });
    }
    return NextResponse.json({ reply: generated.slice(0, 3000), mode: 'gemini' });
  } catch (error) {
    console.error('Concierge request failed:', error.message);
    return NextResponse.json({ reply: 'I’m having trouble reaching the Concierge service right now. Please try again shortly, or contact Artiste Support using WhatsApp or email below.', mode: 'fallback' }, { status: 200 });
  }
}
