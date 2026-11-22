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
  X
} from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const STARTERS = [
  {
    label: 'Find an artwork',
    icon: Palette,
    text: 'Help me find an original painting for my home.'
  },
  {
    label: 'Explore photography',
    icon: Camera,
    text: 'Show me the Fine-Art Photography collection.'
  },
  {
    label: 'Track an order',
    icon: PackageCheck,
    text: 'I would like to track my order.'
  },
];

function clientFallback(message) {
  const q = String(message || '').toLowerCase();

  if (/track|order|bill|bos-ar|awb|dispatch/.test(q)) {
    return 'Please share your Artiste Order ID or Bill Number (BOS-AR-…) and I’ll look for the latest safe order and dispatch details. You can also open My Orders in your account for the official Bill of Supply.';
  }

  if (/photo|photograph|print|edition/.test(q)) {
    return 'Our Photography Wing features curated Fine-Art Photographs, with edition and print details shown on individual listings. Explore the available works at /photography.';
  }

  if (/paint|artwork|wall|decor|living room|bedroom/.test(q)) {
    return 'I’d be delighted to help you find a piece for your space. Browse original paintings in the Collection, and tell me the room, colours or mood you have in mind.';
  }

  if (/creator|artist|painter|sell|onboard|upload/.test(q)) {
    return 'Painters and Photographers can use the same Artist Portal to sign in, complete their profile and list original works. Visit /artist to get started.';
  }

  return 'I’m here to help with Artiste artworks, photography, creator listings, orders, delivery and Bills of Supply. What would you like to explore?';
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [bubbleFading, setBubbleFading] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('');

  const endRef = useRef(null);
  const inputRef = useRef(null);

  const whatsappUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(
    'Hello Artiste Support, I need help with: '
  )}`;

  const emailUrl = `mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent(
    'Artiste Gallery Host — Support'
  )}`;

  useEffect(() => {
    let alreadyShown = false;

    try {
      alreadyShown =
        window.sessionStorage.getItem('artiste-rayna-greeting-shown') === '1';

      if (!alreadyShown) {
        window.sessionStorage.setItem('artiste-rayna-greeting-shown', '1');
      }
    } catch {}

    if (alreadyShown) return undefined;

    setBubbleVisible(true);

    const fadeTimer = window.setTimeout(() => {
      setBubbleFading(true);
    }, 5000);

    const hideTimer = window.setTimeout(() => {
      setBubbleVisible(false);
    }, 5700);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    endRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 120);

    return () => window.clearTimeout(focusTimer);
  }, [messages, open, sending]);

  async function ask(text) {
    const cleaned = String(text || '').trim();

    if (!cleaned || sending) return;

    const nextMessages = [
      ...messages,
      { from: 'user', text: cleaned }
    ].slice(-12);

    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: nextMessages.map(({ from, text: messageText }) => ({
            from,
            text: messageText
          }))
        }),
        cache: 'no-store'
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Rayna is temporarily unavailable.');
      }

      setMode(result.mode || 'fallback');

      setMessages((current) => [
        ...current,
        {
          from: 'bot',
          text: result.reply || clientFallback(cleaned)
        }
      ].slice(-14));

    } catch {
      setMode('fallback');

      setMessages((current) => [
        ...current,
        {
          from: 'bot',
          text: clientFallback(cleaned)
        }
      ].slice(-14));

    } finally {
      setSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  function handleAvatarError() {
    setAvatarFailed(true);
  }

  function RaynaAvatarFallback({ compact = false }) {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#F3ECE1] via-[#E9D9C5] to-[#D9B995] text-[#263832] ${
          compact ? 'rounded-xl' : 'rounded-2xl'
        }`}
        aria-label="Rayna avatar placeholder"
      >
        <Sparkles
          size={compact ? 15 : 23}
          className="text-[#B85D3B]"
        />
        <span className={`font-serif font-bold ${compact ? 'text-xl' : 'text-3xl'}`}>
          R
        </span>
        <span className="text-[7px] font-semibold uppercase tracking-[.18em]">
          Artiste
        </span>
      </div>
    );
  }

  return (
    <div
      className="site-chrome concierge-widget fixed bottom-4 right-4 z-[90] flex w-max max-w-[calc(100vw-24px)] flex-col items-end gap-2.5 sm:bottom-5 sm:right-5"
      aria-live="polite"
    >
      <style jsx global>{`
        @keyframes waveFloat {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }

          25% {
            transform: translateY(-2px) rotate(-1deg);
          }

          50% {
            transform: translateY(-4px) rotate(1deg);
          }

          75% {
            transform: translateY(-2px) rotate(-0.5deg);
          }
        }

        .rayna-wave-float {
          animation: waveFloat 3.6s ease-in-out infinite;
          transform-origin: 50% 85%;
          will-change: transform;
        }

        @keyframes rayna-hand-wave {
          0%, 100% {
            transform: rotate(0deg);
          }

          15% {
            transform: rotate(17deg);
          }

          30% {
            transform: rotate(-9deg);
          }

          45% {
            transform: rotate(17deg);
          }

          60% {
            transform: rotate(-5deg);
          }

          75% {
            transform: rotate(10deg);
          }
        }

        .rayna-wave-hand {
          display: inline-block;
          transform-origin: 70% 75%;
          animation: rayna-hand-wave 1.8s ease-in-out 2;
        }

        .rayna-welcome-pop {
          animation: rayna-welcome-in 420ms cubic-bezier(.2,.8,.2,1) both;
        }

        @keyframes rayna-welcome-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(.97);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .rayna-wave-float,
          .rayna-wave-hand,
          .rayna-welcome-pop {
            animation: none !important;
          }
        }
      `}</style>

      {open && (
        <section
          className="flex max-h-[min(650px,calc(100dvh-112px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-[#D9C6A6] bg-[#FAF6F0] shadow-[0_24px_80px_rgba(38,56,50,.22)]"
          aria-label="Rayna — Artiste Gallery Host"
          role="dialog"
          aria-modal="false"
        >
          {/* Chat header */}
          <header className="flex items-center justify-between gap-3 bg-[#263832] px-4 py-3.5 text-[#FAF6F0] sm:px-5">
            <div className="flex min-w-0 items-center gap-3">

              <span className="relative block h-14 w-12 shrink-0 overflow-hidden rounded-xl border border-[#D8B78D] bg-[#F3ECE1] shadow-inner">
                {!avatarFailed ? (
                  <img
                    src="/rayna-avatar.png"
                    alt="Rayna waving"
                    width="48"
                    height="56"
                    draggable={false}
                    onError={handleAvatarError}
                    className="rayna-wave-float h-full w-full rounded-xl object-contain object-bottom"
                  />
                ) : (
                  <RaynaAvatarFallback compact />
                )}

                <span
                  className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#263832] bg-[#D7B382]"
                  aria-hidden="true"
                />
              </span>

              <span className="min-w-0">
                <b className="block truncate font-serif text-xl leading-none">
                  Rayna
                </b>

                <small className="mt-1.5 block text-[9px] uppercase tracking-[.16em] text-[#D7C5B1]">
                  Artiste Gallery Host
                </small>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#E9DCCD] transition hover:bg-white/10"
              aria-label="Close Rayna chat"
            >
              <X size={18} />
            </button>
          </header>

          {/* Conversation */}
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
            aria-live="polite"
          >
            <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-[#E3D7C8] bg-white/85 px-3.5 py-3 text-[12px] leading-6 text-[#35453D] shadow-sm">
              Hi! What kind of help do you need today?
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
                key={`${message.from}-${index}`}
                className={`flex ${
                  message.from === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-6 ${
                    message.from === 'user'
                      ? 'rounded-tr-sm bg-[#263832] text-[#FAF6F0]'
                      : 'rounded-tl-sm border border-[#E3D7C8] bg-white/85 text-[#35453D] shadow-sm'
                  }`}
                >
                  {message.text}
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

          {/* Message input and support links */}
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
                  : 'Rayna · Gallery host'}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Floating Rayna portrait and greeting bubble */}
      <div className="flex w-full items-end justify-end gap-2 sm:gap-3">

        {bubbleVisible && !open && (
          <div
            role="status"
            className={`rayna-welcome-pop mb-2 min-w-0 w-[min(178px,calc(100vw-132px))] rounded-2xl rounded-br-md border border-[#D9C6A6] bg-[#FAF6F0] px-3.5 py-3 text-[11px] leading-5 text-[#35453D] shadow-[0_12px_35px_rgba(38,56,50,.13)] transition-all duration-700 ${
              bubbleFading
                ? 'translate-y-1 opacity-0'
                : 'translate-y-0 opacity-100'
            }`}
          >
            <span className="rayna-wave-hand mr-1">👋</span>
            Hi! I&apos;m Rayna — what help do you need?
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setOpen((current) => !current);
            setBubbleVisible(false);
          }}
          className="group flex w-24 shrink-0 flex-col overflow-hidden rounded-2xl border border-[#D4B58E] bg-[#263832] p-0 text-[#FAF6F0] shadow-[0_12px_36px_rgba(38,56,50,.25)] transition hover:-translate-y-1 hover:shadow-[0_16px_42px_rgba(38,56,50,.32)] focus:outline-none focus:ring-4 focus:ring-[#C69C6D]/30"
          aria-expanded={open}
          aria-label={
            open
              ? 'Close Rayna, Artiste Gallery Host'
              : 'Chat with Rayna, Artiste Gallery Host'
          }
        >
          {/* Full, unclipped standing portrait */}
          <span className="relative block h-28 w-24 shrink-0 overflow-hidden rounded-t-2xl bg-gradient-to-b from-[#F3ECE1] to-[#E7D8C5]">

            {!avatarFailed ? (
              <img
                src="/rayna-avatar.png"
                alt="Rayna — Artiste Gallery Host, waving"
                width="96"
                height="112"
                draggable={false}
                onError={handleAvatarError}
                className="rayna-wave-float h-full w-full rounded-t-2xl object-contain object-bottom"
              />
            ) : (
              <RaynaAvatarFallback />
            )}

            <span
              className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#F3ECE1] bg-[#8CA77D]"
              aria-hidden="true"
            />
          </span>

          {/* Small identity strip */}
          <span className="flex w-full flex-col items-center justify-center border-t border-[#C69C6D]/50 bg-[#263832] px-1 py-1.5 leading-tight">
            <b className="font-serif text-[13px]">
              Rayna
            </b>

            <small className="mt-0.5 text-[6px] uppercase tracking-[.12em] text-[#D7C5B1]">
              Gallery Host
            </small>
          </span>
        </button>
      </div>
    </div>
  );
}
