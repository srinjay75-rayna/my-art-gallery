"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CreditCard, Mail, MessageCircle, PackageCheck, Palette, Send, ShieldCheck, Truck, X, Camera, FileText } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const quickActions = [
  { label: 'Shipping & live courier quotes', icon: Truck },
  { label: 'Paintings & Photography', icon: Camera },
  { label: 'Creator onboarding', icon: Palette },
  { label: 'Payments & Bills', icon: CreditCard },
  { label: 'Order tracking', icon: PackageCheck },
  { label: 'Non-GST Bill of Supply', icon: FileText },
  { label: 'Packaging & transit damage', icon: ShieldCheck },
];

function localFallback(message) {
  const q = String(message || '').toLowerCase();
  if (/ship|deliver|courier|awb|tracking|pincode|pin code/.test(q)) return 'Live Shiprocket rates are calculated during checkout between each creator studio pickup PIN and your delivery PIN. Add a work to your basket, complete your delivery details and request live delivery options.';
  if (/photo|photograph|print|edition/.test(q)) return 'Explore the curated Fine-Art Photography collection at /photography. Each listing may include edition and print details. Original paintings remain the primary Artiste collection.';
  if (/creator|photographer|painter|artist|onboard|apply|sell|join/.test(q)) return 'Painters and Photographers share the same creator portal at /artist. Choose your Creator Role during onboarding or profile editing, complete your studio and payout details, then publish your works.';
  if (/bill|invoice|gst|payment|razorpay/.test(q)) return 'After payment is confirmed, open My Orders at /account and choose View / Download Official Bill (PDF). Artiste provides a non-GST Bill of Supply with the artwork and shipping breakdown.';
  if (/damage|broken|package|return/.test(q)) return 'Keep the original packaging and a continuous unboxing video, then contact Artiste Support promptly with your order reference so the case can be reviewed under the Shipping & Returns policy.';
  return 'I can help with Artiste paintings, Fine-Art Photography, creator onboarding, live Shiprocket quotes, Razorpay payments, Bills of Supply and order support. Please share a little more detail, or use the support links below.';
}

export default function ArtisteConcierge() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Welcome to Artiste. I’m your Gallery Concierge for original paintings, Fine-Art Photography, creator onboarding, live delivery quotations, payments and Bills of Supply. How may I help?' }]);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('');
  const endRef = useRef(null);
  const whatsappUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent('Hello Artiste Support, I need help with: ')}`;
  const emailUrl = `mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Artiste Customer Support')}`;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, open, sending]);

  async function ask(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned || sending) return;
    const nextMessages = [...messages, { from: 'user', text: cleaned }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages.map(({ from, text: messageText }) => ({ from, text: messageText })) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Concierge is temporarily unavailable.');
      setMode(result.mode || 'fallback');
      setMessages((current) => [...current, { from: 'bot', text: result.reply || localFallback(cleaned) }]);
    } catch (error) {
      setMode('fallback');
      setMessages((current) => [...current, { from: 'bot', text: localFallback(cleaned) }]);
    } finally { setSending(false); }
  }

  return <div className="site-chrome fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-3" aria-live="polite">
    {open && <section className="flex max-h-[min(700px,calc(100vh-110px))] w-[min(410px,calc(100vw-32px))] flex-col overflow-hidden rounded-[24px] border border-[#e1d5c7] bg-[#fffdf8] shadow-[0_24px_80px_rgba(40,35,31,.24)]" aria-label="Artiste Gallery Concierge chat">
      <header className="flex items-center justify-between bg-[#28231f] px-5 py-4 text-[#f8efe4]"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d6b797]/50 font-serif text-xl text-[#e8c6a8]">A</span><div><p className="font-serif text-xl leading-none">Artiste Gallery Concierge</p><p className="mt-1 text-[9px] uppercase tracking-[.16em] text-[#cbb9a4]">A thoughtful guide to Artiste</p></div></div><button onClick={() => setOpen(false)} className="rounded-full p-2 text-[#e8d9c8] transition hover:bg-white/10" aria-label="Close Concierge"><X size={18}/></button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#faf6ef] p-4">{messages.map((message, index) => <div key={`${index}-${message.from}`} className={`flex ${message.from === 'user' ? 'justify-end' : 'justify-start'}`}><p className={`max-w-[90%] whitespace-pre-line rounded-2xl px-3.5 py-3 text-xs leading-6 ${message.from === 'user' ? 'rounded-br-md bg-[#a24d36] text-white' : 'rounded-bl-md border border-[#ece3d8] bg-white text-[#51483f]'}`}>{message.text}</p></div>)}{sending && <div className="flex justify-start"><p className="rounded-2xl rounded-bl-md border border-[#ece3d8] bg-white px-3.5 py-3 text-xs text-[#88796b]">Artiste Concierge is thinking…</p></div>}<div ref={endRef}/></div>
      <div className="border-t border-[#e8dfd4] bg-[#fffdf8] p-4"><p className="mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#88796b]">Quick actions</p><div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{quickActions.map(({ label, icon: Icon }) => <button key={label} disabled={sending} onClick={() => ask(label)} className="inline-flex items-center gap-1.5 rounded-full border border-[#e3d8ca] px-2.5 py-1.5 text-[9px] font-semibold text-[#65594d] transition hover:border-[#b77a61] hover:bg-[#f8f0e8] disabled:opacity-50"><Icon size={11}/> {label}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); ask(input); }} className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} disabled={sending} className="field !rounded-full !py-2.5 !text-xs" placeholder="Ask anything about Artiste…" aria-label="Ask Artiste Concierge"/><button type="submit" disabled={!input.trim() || sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#a24d36] text-white transition hover:bg-[#843e2c] disabled:opacity-40" aria-label="Send message"><Send size={15}/></button></form>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eee6db] pt-3"><span className="text-[9px] text-[#8a7e72]">Need a person?</span><div className="flex gap-2"><a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#edf4ec] px-2.5 py-1.5 text-[9px] font-bold text-[#46634a]"><MessageCircle size={11}/> WhatsApp</a><a href={emailUrl} className="inline-flex items-center gap-1 rounded-full bg-[#f2ece4] px-2.5 py-1.5 text-[9px] font-bold text-[#74503f]"><Mail size={11}/> Email</a></div></div>
        <div className="mt-2 flex items-center justify-between"><a href="/shipping-returns" className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[.12em] text-[#a24d36] hover:underline">Shipping &amp; Returns <ArrowUpRight size={11}/></a><span className="text-[8px] text-[#a69a8d]">{mode === 'gemini' ? 'AI Concierge' : 'Support Concierge'}</span></div>
      </div>
    </section>}
    <button onClick={() => setOpen((value) => !value)} className="group flex items-center gap-2 rounded-full border border-[#c6a68a] bg-[#28231f] px-4 py-3 text-white shadow-[0_10px_30px_rgba(40,35,31,.24)] transition hover:-translate-y-0.5 hover:bg-[#3a3029]" aria-expanded={open} aria-label={open ? 'Close Artiste Concierge' : 'Open Artiste Concierge'}>{open ? <X size={17}/> : <MessageCircle size={17}/>}<span className="text-[10px] font-bold uppercase tracking-[.14em]">Artiste Concierge</span>{!open && <span className="h-1.5 w-1.5 rounded-full bg-[#d6ab82]"/>}</button>
  </div>;
}
