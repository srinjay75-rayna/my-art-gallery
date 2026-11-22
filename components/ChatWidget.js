"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  Mail,
  MessageCircle,
  PackageCheck,
  Palette,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const MAX_SENT_TURNS = 16;      // turns sent to /api/chat for context
const MAX_KEPT_TURNS = 60;      // turns kept on screen
const MAX_INPUT_CHARS = 1800;
const CLIENT_TIMEOUT_MS = 22000;
const CLOSE_AFTER_GOODBYE_MS = 1500;
const INITIAL_GREETING = 'Hello, and welcome to Artiste! I’m Rayna, your gallery host. How can I help you today?';

const STARTERS = [
  { label: 'Find an artwork', icon: Palette, text: 'Help me find an original painting for my home.' },
  { label: 'Explore photography', icon: Camera, text: 'Tell me about the Fine-Art Photography collection.' },
  { label: 'Track an order', icon: PackageCheck, text: 'I would like to track my order.' },
];

const GOODBYE_PATTERN = /\b(bye(?:\s+bye)?|goodbye|good\s*night|see you(?: later)?|you can leave|close(?: the| this)? chat|close the window|talk later|that's all|that is all|that's enough|done for now|i am done|i'm done|nothing else|no more help)\b/;

function isGoodbye(text) {
  const normalised = String(text || '').toLowerCase().replace(/[’‘]/g, "'");
  // A long message that merely contains "that's all" is a question, not a farewell.
  if (normalised.split(/\s+/).filter(Boolean).length > 10) return false;
  return GOODBYE_PATTERN.test(normalised);
}

function clientFallback(message) {
  const q = String(message || '').toLowerCase().replace(/[’‘]/g, "'");
  if (isGoodbye(q)) {
    return 'It was lovely helping you today. Thank you for visiting Artiste, and do come back whenever you feel like exploring something beautiful. Take care!';
  }
  if (/\b(track|order|bill|bos-ar|awb|dispatch)\b/.test(q)) {
    return 'Please share your Artiste Order ID or Bill Number (BOS-AR-…) and I’ll help you find the latest order and dispatch details. You can also visit My Orders in your account for your official Bill of Supply.';
  }
  if (/\b(photo|photograph\w*|print|edition)\b/.test(q)) {
    return 'Our Photography Wing features curated Fine-Art Photographs, with edition and print details on each listing. You can explore it at /photography.';
  }
  if (/\b(paint\w*|artwork\w*|wall|decor|living room|bedroom)\b/.test(q)) {
    return 'I’d be delighted to help you find something special for your space. Tell me the room, colours or mood you have in mind.';
  }
  if (/\b(creator|artist|painter|sell|onboard|upload)\b/.test(q)) {
    return 'Painters and Photographers can use the same Artist Portal to complete their profiles and list original works. Visit /artist to get started.';
  }
  if (/\b(delivery|shiprocket|shipping|courier)\b/.test(q)) {
    return 'Live Shiprocket rates are calculated at checkout from the creator’s pickup PIN to your delivery PIN. Courier updates appear in My Orders after dispatch.';
  }
  return 'I’m having a little trouble connecting right now. Please try again in a moment, or reach our team on WhatsApp or email below.';
}

// Turns internal routes mentioned by Rayna into client-side links so the
// conversation survives navigation (a plain <a> would reload the page).
const ROUTE_PATTERN = /(^|[\s(])(\/(?:photography|artists|artist|account|shipping-returns))(?=[\s).,;:!?]|$)/g;

function renderMessage(text, onNavigate) {
  const nodes = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(ROUTE_PATTERN)) {
    const start = match.index + match[1].length;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <Link
        key={`route-${key++}`}
        href={match[2]}
        onClick={onNavigate}
        className="font-semibold text-[#B85D3B] underline underline-offset-2"
      >
        {match[2]}
      </Link>
    );
    last = start + match[2].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

function AvatarFallback({ compact = false }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center text-[#263832] ${compact ? 'text-2xl' : 'text-5xl'}`}
      aria-label="Rayna avatar"
    >
      <Sparkles size={compact ? 16 : 26} className="text-[#B85D3B]" />
      <span className="font-serif font-bold">R</span>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [greetingDismissed, setGreetingDismissed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [input, setInput] = useState('');
  // Only real conversation turns live here; the opening greeting is rendered
  // separately so the history sent to Gemini always starts with a user turn.
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('');

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const farewellTimerRef = useRef(null);

  const whatsappUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent('Hello Artiste Support, I need help with: ')}`;
  const emailUrl = `mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Artiste — Gallery Support')}`;

  const clearFarewellTimer = useCallback(() => {
    if (farewellTimerRef.current) {
      window.clearTimeout(farewellTimerRef.current);
      farewellTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (farewellTimerRef.current) window.clearTimeout(farewellTimerRef.current);
    };
  }, []);

  // Keep the newest message in view without scrolling the page behind it.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  // Focus the field on desktop only: auto-focusing on touch screens would pop
  // the keyboard over the conversation every time a reply arrives.
  useEffect(() => {
    if (!open || sending) return undefined;
    if (!window.matchMedia?.('(pointer: fine)').matches) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, sending, messages.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const ask = useCallback(async (text) => {
    const cleaned = String(text || '').trim().slice(0, MAX_INPUT_CHARS);
    // The ref guard blocks a double-tap before React has re-rendered `sending`.
    if (!cleaned || sendingRef.current) return;
    sendingRef.current = true;
    clearFarewellTimer();

    const history = [...messagesRef.current, { role: 'user', content: cleaned }];
    setMessages(history.slice(-MAX_KEPT_TURNS));
    setInput('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    let reply = '';
    let replyMode = 'fallback';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-MAX_SENT_TURNS) }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 429) {
        reply = String(result.error || 'Please pause for a moment before sending another message.');
        replyMode = 'notice';
      } else if (!response.ok) {
        throw new Error(result.error || 'Rayna is temporarily unavailable.');
      } else {
        reply = String(result.reply || '').trim() || clientFallback(cleaned);
        replyMode = result.mode || 'fallback';
      }
    } catch (error) {
      if (!mountedRef.current) return;
      console.error('Rayna chat request failed in the browser:', error?.message || error);
      reply = clientFallback(cleaned);
      replyMode = 'fallback';
    } finally {
      window.clearTimeout(timeout);
      sendingRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setSending(false);
    }

    if (!mountedRef.current) return;
    setMode(replyMode);
    setMessages((current) => [...current, { role: 'assistant', content: reply }].slice(-MAX_KEPT_TURNS));

    // Goodbyes are answered by Rayna first; the window then closes 1.5s later.
    if (isGoodbye(cleaned)) {
      farewellTimerRef.current = window.setTimeout(() => {
        farewellTimerRef.current = null;
        setOpen(false);
      }, CLOSE_AFTER_GOODBYE_MS);
    }
  }, [clearFarewellTimer]);

  function handleSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  function openChat() {
    // A deliberate click on Rayna cancels any pending goodbye auto-close.
    clearFarewellTimer();
    setGreetingDismissed(true);
    setOpen(true);
  }

  function closeChat() {
    clearFarewellTimer();
    setOpen(false);
  }

  return (
    <>
      <style>{`
        @keyframes rayna-shoulder-wave {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(2deg); }
          55% { transform: rotate(-3deg); }
          80% { transform: rotate(1.5deg); }
          100% { transform: rotate(0deg); }
        }
        .rayna-portrait {
          transform-origin: 72% 65%;
          animation: rayna-shoulder-wave 2.2s ease-in-out 2;
          backface-visibility: hidden;
          will-change: transform;
        }
        .rayna-character:hover .rayna-portrait {
          animation: rayna-shoulder-wave 1.9s ease-in-out infinite;
        }
        @keyframes rayna-greeting-appear {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rayna-greeting { animation: rayna-greeting-appear 450ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .rayna-portrait,
          .rayna-character:hover .rayna-portrait,
          .rayna-greeting { animation: none !important; transform: none !important; }
        }
      `}</style>

      {open && (
        <section
          className="site-chrome concierge-widget fixed bottom-4 right-4 z-50 w-[360px] max-w-[92vw] h-[520px] max-h-[82dvh] flex flex-col overflow-hidden rounded-[24px] border border-[#D9C6A6] bg-[#FAF6F0] shadow-[0_24px_80px_rgba(38,56,50,.28)]"
          aria-label="Rayna — Artiste AI Assistant"
          role="dialog"
          aria-modal="false"
        >
          <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-[#D9C6A6] bg-[#263832] px-4 py-3 text-[#FAF6F0]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="block h-12 w-11 shrink-0 overflow-hidden rounded-xl bg-[#FAF6F0]">
                {!avatarFailed ? (
                  <img
                    src="/rayna-avatar.png"
                    alt="Rayna"
                    width="44"
                    height="48"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    onError={() => setAvatarFailed(true)}
                    className="h-full w-full object-contain mix-blend-multiply"
                  />
                ) : <AvatarFallback compact />}
              </span>
              <span className="min-w-0">
                <b className="block truncate font-serif text-xl leading-none">Rayna</b>
                <small className="mt-1.5 block truncate text-[10px] uppercase tracking-[.14em] text-[#D7C5B1]" aria-live="polite">
                  {sending ? 'Rayna is typing...' : 'Artiste AI Assistant'}
                </small>
              </span>
            </div>
            <button
              type="button"
              onClick={closeChat}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#D7C5B1]/60 bg-white/10 text-3xl font-light leading-none text-white transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-[#D7B382]"
              aria-label="Close Rayna chat"
              title="Close chat"
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
          >
            <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-[#E3D7C8] bg-white/85 px-3.5 py-3 text-[13px] leading-6 text-[#35453D] shadow-sm">
              {INITIAL_GREETING}
            </div>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map(({ label, icon: Icon, text }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => ask(text)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#D9C6A6] bg-[#F3ECE1] px-3 py-2 text-[11px] font-medium text-[#53615A] transition hover:border-[#B85D3B] hover:text-[#B85D3B]"
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-6 ${
                  message.role === 'user'
                    ? 'rounded-tr-sm bg-[#263832] text-[#FAF6F0]'
                    : 'rounded-tl-sm border border-[#E3D7C8] bg-white/85 text-[#35453D] shadow-sm'
                }`}>
                  {message.role === 'user' ? message.content : renderMessage(message.content, closeChat)}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start" aria-hidden="true">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-[#E3D7C8] bg-white/85 px-4 py-3 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B85D3B] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B85D3B] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B85D3B]" />
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#E3D7C8] bg-[#F7F1E8] px-3.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={sending}
                className="field min-w-0 flex-1 !rounded-full !bg-white !py-3 !text-base sm:!text-sm"
                placeholder="Write your message…"
                aria-label="Message Rayna"
                maxLength={MAX_INPUT_CHARS}
                autoComplete="off"
                enterKeyHint="send"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#B85D3B] text-white transition hover:bg-[#984B32] disabled:opacity-40"
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            </form>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#E7DDD0] pt-2.5">
              <span className="text-[10px] text-[#8A7E72]">Speak to our team</span>
              <div className="flex gap-2">
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#E8F0E5] px-2.5 py-1.5 text-[10px] font-bold text-[#46634A]"><MessageCircle size={11} /> WhatsApp</a>
                <a href={emailUrl} className="inline-flex items-center gap-1 rounded-full bg-[#EEE7DE] px-2.5 py-1.5 text-[10px] font-bold text-[#74503F]"><Mail size={11} /> Email</a>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Link href="/shipping-returns" onClick={closeChat} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[.12em] text-[#B85D3B] hover:underline">Shipping &amp; Returns <ArrowUpRight size={11} /></Link>
              <span className="text-[9px] text-[#A69A8D]">{mode === 'gemini' ? 'Rayna · AI host' : 'Rayna · Gallery assistant'}</span>
            </div>
          </div>
        </section>
      )}

      {!open && (
        <div className="site-chrome concierge-widget fixed bottom-4 right-3 z-50 flex max-w-[calc(100vw-24px)] items-end justify-end gap-2 sm:bottom-5 sm:right-5 sm:gap-3">
          {!greetingDismissed && (
            <div className="rayna-greeting relative mb-16 flex w-[min(210px,calc(100vw-176px))] items-start gap-2 rounded-2xl rounded-br-md border border-[#E1D0B9] bg-[#FFFDF8] px-3.5 py-3 text-[11px] leading-5 text-[#35453D] shadow-[0_8px_28px_rgba(38,56,50,.12)] sm:mb-20">
              <span className="min-w-0 flex-1"><span className="mr-1">👋</span> Hi! I am Rayna, I am your AI assistant.</span>
              <button
                type="button"
                onClick={() => setGreetingDismissed(true)}
                className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#9A8874] transition hover:bg-[#F0E8DC] hover:text-[#B85D3B]"
                aria-label="Dismiss Rayna greeting"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={openChat}
            className="rayna-character group flex shrink-0 flex-col items-center border-0 bg-transparent p-0 shadow-none outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-[#C69C6D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF6F0]"
            aria-expanded={false}
            aria-label="Chat with Rayna, your Artiste AI Assistant"
          >
            <span className="relative block h-36 w-36 shrink-0">
              {!avatarFailed ? (
                <img
                  src="/rayna-avatar.png"
                  alt="Rayna, your Artiste AI Assistant, waving"
                  width="144"
                  height="144"
                  loading="eager"
                  decoding="async"
                  draggable={false}
                  onError={() => setAvatarFailed(true)}
                  className="rayna-portrait h-full w-full object-contain mix-blend-multiply"
                />
              ) : <AvatarFallback />}
            </span>
            <span className="mt-0.5 rounded-full border border-[#DCC9AE] bg-[#F3ECE1]/90 px-3.5 py-1.5 font-serif text-[10px] font-semibold tracking-wide text-[#263832] transition group-hover:border-[#B85D3B] group-hover:bg-[#FFFDF8]">
              Rayna · AI Assistant
            </span>
          </button>
        </div>
      )}
    </>
  );
}
