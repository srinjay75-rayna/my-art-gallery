"use client";

import { useEffect, useRef, useState } from 'react';
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

const MAX_HISTORY = 16;

const INITIAL_GREETING =
  'Hi! What kind of help do you need today?';

const STARTERS = [
  {
    label: 'Find an artwork',
    icon: Palette,
    text: 'Help me find an original painting for my home.',
  },
  {
    label: 'Explore photography',
    icon: Camera,
    text: 'Show me the Fine-Art Photography collection.',
  },
  {
    label: 'Track an order',
    icon: PackageCheck,
    text: 'I would like to track my order.',
  },
];

const GOODBYE_PATTERN =
  /\b(bye(?:\s+bye)?|goodbye|good\s*night|see you(?: later)?|you can leave|close(?: the| this)? chat|close the window|talk later|that's all|that is all|that's enough|done for now|i am done|i'm done|nothing else|no more help)\b/i;

function clientFallback(message) {
  const q = String(message || '').toLowerCase();

  if (GOODBYE_PATTERN.test(q)) {
    return 'It was lovely helping you today. Thank you for visiting Artiste, and do come back whenever you feel like exploring something beautiful. Take care!';
  }

  if (/track|order|bill|bos-ar|awb|dispatch/.test(q)) {
    return 'Please share your Artiste Order ID or Bill Number (BOS-AR-…) and I’ll help you find the latest order and dispatch details. You can also visit My Orders in your account for your official Bill of Supply.';
  }

  if (/photo|photograph|print|edition/.test(q)) {
    return 'Our Photography Wing features curated Fine-Art Photographs, with edition and print details on individual listings. Explore the collection at /photography.';
  }

  if (/paint|artwork|wall|decor|living room|bedroom/.test(q)) {
    return 'I’d be delighted to help you find something special for your space. Browse our original paintings and tell me the room, colours or mood you have in mind.';
  }

  if (/creator|artist|painter|sell|onboard|upload/.test(q)) {
    return 'Painters and Photographers can use the same Artist Portal to complete their profiles and list original works. Visit /artist to get started.';
  }

  if (/delivery|shiprocket|shipping|courier/.test(q)) {
    return 'Live Shiprocket rates are calculated at checkout from the creator’s pickup PIN to your delivery PIN. Courier updates appear in My Orders after dispatch.';
  }

  return 'I’m here to help with Artiste paintings, Fine-Art Photography, creators, orders, delivery and Bills of Supply. What would you like to explore?';
}

function AvatarFallback({ compact = false }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center text-[#263832] ${
        compact ? 'text-2xl' : 'text-5xl'
      }`}
      aria-label="Rayna avatar"
    >
      <Sparkles
        size={compact ? 16 : 26}
        className="text-[#B85D3B]"
      />
      <span className="font-serif font-bold">R</span>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [greetingDismissed, setGreetingDismissed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('');

  const endRef = useRef(null);
  const inputRef = useRef(null);
  const farewellTimerRef = useRef(null);

  const whatsappUrl =
    `https://wa.me/${siteConfig.whatsappNumber}?text=${
      encodeURIComponent(
        'Hello Artiste Support, I need help with: '
      )
    }`;

  const emailUrl =
    `mailto:${siteConfig.supportEmail}?subject=${
      encodeURIComponent('Artiste — Gallery Support')
    }`;

  useEffect(() => {
    if (!open) return undefined;

    endRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [messages, open, sending]);

  useEffect(() => {
    return () => {
      if (farewellTimerRef.current) {
        window.clearTimeout(farewellTimerRef.current);
      }
    };
  }, []);

  /* ==========================================
     MULTI-TURN GEMINI CONVERSATION
  ========================================== */

  async function ask(text) {
    const cleaned = String(text || '').trim();

    if (!cleaned || sending) return;

    if (farewellTimerRef.current) {
      window.clearTimeout(farewellTimerRef.current);
      farewellTimerRef.current = null;
    }

    const nextMessages = [
      ...messages,
      {
        role: 'user',
        content: cleaned,
      },
    ].slice(-MAX_HISTORY);

    setMessages(nextMessages);
    setInput('');
    setSending(true);

    let reply = '';
    let replyMode = 'fallback';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          messages: nextMessages,
        }),

        cache: 'no-store',
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error || 'Rayna is temporarily unavailable.'
        );
      }

      reply = String(
        result.reply || clientFallback(cleaned)
      );

      replyMode = result.mode || 'fallback';

    } catch (error) {
      console.error(
        'Rayna chat request failed in the browser:',
        error?.message || error
      );

      reply = clientFallback(cleaned);
      replyMode = 'fallback';

    } finally {
      setSending(false);
    }

    setMode(replyMode);

    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        content: reply,
      },
    ].slice(-MAX_HISTORY));

    // Goodbye still goes to Gemini first.
    // Minimise the drawer 1.5 seconds after Rayna responds.

    if (GOODBYE_PATTERN.test(cleaned)) {
      farewellTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        farewellTimerRef.current = null;
      }, 1500);
    } else {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  function toggleChat() {
    if (farewellTimerRef.current) {
      window.clearTimeout(farewellTimerRef.current);
      farewellTimerRef.current = null;
    }

    setGreetingDismissed(true);
    setOpen((current) => !current);
  }

  function closeChat() {
    if (farewellTimerRef.current) {
      window.clearTimeout(farewellTimerRef.current);
      farewellTimerRef.current = null;
    }

    setOpen(false);
  }

  return (
    <div
      className="site-chrome concierge-widget fixed bottom-4 right-4 z-50"
      aria-live="polite"
    >
      <style jsx global>{`
        @keyframes rayna-shoulder-wave {
          0% {
            transform: rotate(0deg);
          }

          25% {
            transform: rotate(2deg);
          }

          55% {
            transform: rotate(-3deg);
          }

          80% {
            transform: rotate(1.5deg);
          }

          100% {
            transform: rotate(0deg);
          }
        }

        .rayna-portrait {
          transform-origin: 72% 65%;
          animation: rayna-shoulder-wave 2.2s ease-in-out 1;
          backface-visibility: hidden;
          will-change: transform;
        }

        .rayna-character:hover .rayna-portrait {
          animation: rayna-shoulder-wave 1.9s ease-in-out infinite;
        }

        @keyframes rayna-greeting-appear {
          from {
            opacity: 0;
            transform: translateY(5px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .rayna-greeting {
          animation: rayna-greeting-appear 450ms ease-out both;
        }

        @media (prefers-reduced-motion: reduce) {
          .rayna-portrait,
          .rayna-character:hover .rayna-portrait,
          .rayna-greeting {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* ======================================
          VIEWPORT-LOCKED CHAT DRAWER
          Standing Rayna portrait is hidden
          while this drawer is open.
      ====================================== */}

      {open && (
        <section
          className="fixed bottom-4 right-4 z-50 flex h-[min(680px,80vh)] w-[360px] max-w-[92vw] max-h-[80vh] flex-col overflow-hidden rounded-[24px] border border-[#D9C6A6] bg-[#FAF6F0] shadow-[0_24px_80px_rgba(38,56,50,.25)]"
          aria-label="Rayna — Artiste AI Assistant"
          role="dialog"
          aria-modal="false"
        >
          {/* Sticky header with always-visible close button */}

          <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[#D9C6A6] bg-[#263832] px-4 py-3.5 text-[#FAF6F0]">

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
                ) : (
                  <AvatarFallback compact />
                )}

              </span>

              <span className="min-w-0">

                <b className="block truncate font-serif text-xl leading-none">
                  Rayna
                </b>

                <small className="mt-1.5 block text-[9px] uppercase tracking-[.16em] text-[#D7C5B1]">
                  Rayna · AI Assistant
                </small>

              </span>

            </div>

            <button
              type="button"
              onClick={closeChat}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#D7C5B1]/60 bg-white/10 text-3xl leading-none text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#D7B382]"
              aria-label="Close Rayna chat"
              title="Close chat"
            >
              ×
            </button>

          </header>

          {/* Scrollable conversation */}

          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
            aria-live="polite"
          >

            <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-[#E3D7C8] bg-white/85 px-3.5 py-3 text-[12px] leading-6 text-[#35453D] shadow-sm">
              {INITIAL_GREETING}
            </div>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">

                {STARTERS.map(({ label, icon: Icon, text }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => ask(text)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#D9C6A6] bg-[#F3ECE1] px-3 py-2 text-[10px] font-medium text-[#53615A] transition hover:border-[#B85D3B] hover:text-[#B85D3B]"
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}

              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${
                  message.role === 'user'
                    ? 'justify-end'
                    : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-6 ${
                    message.role === 'user'
                      ? 'rounded-tr-sm bg-[#263832] text-[#FAF6F0]'
                      : 'rounded-tl-sm border border-[#E3D7C8] bg-white/85 text-[#35453D] shadow-sm'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-2 text-[10px] text-[#85786A]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F3ECE1] text-[#B85D3B]">
                  <Sparkles size={12} />
                </span>

                Rayna is checking the gallery…
              </div>
            )}

            <div ref={endRef} />

          </div>

          {/* Sticky footer and input */}

          <div className="sticky bottom-0 z-20 shrink-0 border-t border-[#E3D7C8] bg-[#F7F1E8] px-3.5 pb-3.5 pt-3 sm:px-4">

            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2"
            >

              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={sending}
                className="field min-w-0 flex-1 !rounded-full !bg-white !py-3 !text-xs"
                placeholder="Write your message…"
                aria-label="Message Rayna"
                maxLength={1800}
              />

              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#B85D3B] text-white transition hover:bg-[#984B32] disabled:opacity-40"
                aria-label="Send message"
              >
                <Send size={15} />
              </button>

            </form>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#E7DDD0] pt-3">

              <span className="text-[9px] text-[#8A7E72]">
                Speak to our team
              </span>

              <div className="flex gap-2">

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-[#E8F0E5] px-2.5 py-1.5 text-[9px] font-bold text-[#46634A]"
                >
                  <MessageCircle size={11} />
                  WhatsApp
                </a>

                <a
                  href={emailUrl}
                  className="inline-flex items-center gap-1 rounded-full bg-[#EEE7DE] px-2.5 py-1.5 text-[9px] font-bold text-[#74503F]"
                >
                  <Mail size={11} />
                  Email
                </a>

              </div>

            </div>

            <div className="mt-2 flex items-center justify-between">

              <a
                href="/shipping-returns"
                className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[.12em] text-[#B85D3B] hover:underline"
              >
                Shipping & Returns
                <ArrowUpRight size={11} />
              </a>

              <span className="text-[8px] text-[#A69A8D]">
                {mode === 'gemini'
                  ? 'Rayna · AI host'
                  : 'Rayna · Gallery assistant'}
              </span>

            </div>

          </div>
        </section>
      )}

      {/* ======================================
          FLOATING RAYNA PORTRAIT
          Hidden while chat is open.
      ====================================== */}

      {!open && (
        <div className="flex items-end justify-end gap-2 sm:gap-3">

          {!greetingDismissed && (
            <div className="rayna-greeting relative mb-16 flex w-[min(210px,calc(100vw-176px))] items-start gap-2 rounded-2xl rounded-br-md border border-[#E1D0B9] bg-[#FFFDF8] px-3.5 py-3 text-[11px] leading-5 text-[#35453D] shadow-[0_8px_28px_rgba(38,56,50,.12)] sm:mb-20">

              <span className="min-w-0 flex-1">
                <span className="mr-1">👋</span>
                Hi! I am Rayna, I am your AI assistant.
              </span>

              <button
                type="button"
                onClick={() => setGreetingDismissed(true)}
                className="-mr-1 -mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#9A8874] transition hover:bg-[#F0E8DC] hover:text-[#B85D3B]"
                aria-label="Dismiss Rayna greeting"
                title="Dismiss"
              >
                <X size={12} />
              </button>

            </div>
          )}

          <div className="flex shrink-0 flex-col items-center">

            <button
              type="button"
              onClick={toggleChat}
              className="rayna-character group flex flex-col items-center border-0 bg-transparent p-0 outline-none shadow-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-[#C69C6D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF6F0]"
              aria-expanded={open}
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
                    fetchPriority="high"
                    draggable={false}
                    onError={() => setAvatarFailed(true)}
                    className="rayna-portrait h-full w-full object-contain mix-blend-multiply"
                  />
                ) : (
                  <AvatarFallback />
                )}

              </span>

              <span className="mt-0.5 rounded-full border border-[#DCC9AE] bg-[#F3ECE1]/90 px-3.5 py-1.5 font-serif text-[10px] font-semibold tracking-wide text-[#263832] transition group-hover:border-[#B85D3B] group-hover:bg-[#FFFDF8]">
                Rayna · AI Assistant
              </span>

            </button>

          </div>

        </div>
      )}

    </div>
  );
}
