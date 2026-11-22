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

function clientFallback(message) {
  const q = String(message || '').toLowerCase();

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
    return 'Live Shiprocket rates are calculated at checkout from the creator’s pickup PIN to your delivery PIN. Once an order is placed, courier updates appear in My Orders.';
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

  // Store complete conversational history using Gemini-compatible roles.
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: INITIAL_GREETING,
    },
  ]);

  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('');

  const endRef = useRef(null);
  const inputRef = useRef(null);

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

  /* ==========================================
     MULTI-TURN CONVERSATIONAL REQUEST
  ========================================== */

  async function ask(text) {
    const cleaned = String(text || '').trim();

    if (!cleaned || sending) return;

    // Preserve earlier conversation and append the latest user message.
    // The complete latest 16 messages are sent on every request.

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

      const reply = String(
        result.reply || clientFallback(cleaned)
      );

      setMode(result.mode || 'fallback');

      // Append Rayna's answer as an assistant turn.
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: reply,
        },
      ].slice(-MAX_HISTORY));

    } catch {
      setMode('fallback');

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: clientFallback(cleaned),
        },
      ].slice(-MAX_HISTORY));

    } finally {
      setSending(false);

      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  function openChat() {
    setGreetingDismissed(true);
    setOpen(true);
  }

  return (
    <div className="site-chrome concierge-widget fixed bottom-4 right-3 z-[90] flex max-w-[calc(100vw-24px)] flex-col items-end gap-2 sm:bottom-5 sm:right-5">

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
          RAYNA CHAT WINDOW
      ====================================== */}

      {open && (
        <section
          className="flex max-h-[min(650px,calc(100dvh-110px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-[#D9C6A6] bg-[#FAF6F0] shadow-[0_24px_80px_rgba(38,56,50,.20)]"
          aria-label="Rayna — Artiste AI Assistant"
          role="dialog"
          aria-modal="false"
        >

          {/* Header */}
          <header className="flex items-center justify-between gap-3 border-b border-[#E5D8C7] bg-[#FAF6F0] px-4 py-3.5 sm:px-5">

            <div className="flex min-w-0 items-center gap-3">

              <span className="block h-14 w-12 shrink-0 overflow-hidden rounded-xl bg-[#FAF6F0]">

                {!avatarFailed ? (
                  <img
                    src="/rayna-avatar.png"
                    alt="Rayna"
                    width="48"
                    height="56"
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

                <b className="block truncate font-serif text-xl leading-none text-[#263832]">
                  Rayna
                </b>

                <small className="mt-1.5 block text-[9px] uppercase tracking-[.16em] text-[#927A61]">
                  AI Assistant
                </small>

              </span>

            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#64736A] transition hover:bg-[#F0E8DC] hover:text-[#B85D3B]"
              aria-label="Close Rayna chat"
            >
              <X size={18} />
            </button>

          </header>

          {/* Conversation history */}
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
            aria-live="polite"
          >

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

            {/* Starter suggestions */}
            {messages.length === 1 && (
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

            {/* Loading indicator */}
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

          {/* Input and contact options */}
          <div className="border-t border-[#E3D7C8] bg-[#F7F1E8] px-3.5 pb-3.5 pt-3 sm:px-4">

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
          FLOATING RAYNA PORTRAIT AND GREETING
      ====================================== */}

      <div className="flex items-end justify-end gap-2 sm:gap-3">

        {/* Persistent, dismissible greeting */}
        {!greetingDismissed && !open && (
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

        {/* Rayna's unclipped high-resolution cutout */}
        <div className="flex shrink-0 flex-col items-center">

          <button
            type="button"
            onClick={openChat}
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
    </div>
  );
}
