"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CreditCard, Mail, MessageCircle, PackageCheck, Palette, Send, ShieldCheck, Truck, X } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const topics = [
  { label: 'Shipping & Delivery', icon: Truck },
  { label: 'Packaging & Transit Damage', icon: ShieldCheck },
  { label: 'Payment Methods', icon: CreditCard },
  { label: 'Artist Applications', icon: Palette },
  { label: 'Order Tracking', icon: PackageCheck },
];

const answerByTopic = {
  'Shipping & Delivery': 'We arrange Pan-India courier dispatch through Shiprocket, generally within 2–4 business days after payment confirmation. Once the shipment is booked, tracking details are shared in your Artiste account. Delivery time after dispatch depends on your destination and the courier route.',
  'Packaging & Transit Damage': 'Original paintings are prepared in protective, artwork-appropriate packaging designed for safe transit. Our transit-damage protection window is 48 hours from delivery. Please record a continuous unboxing video before opening, keep the packaging, and email clear photos plus the video to support within 48 hours so the issue can be reviewed with the courier. See our Shipping & Returns policy for the full process.',
  'Payment Methods': 'Payments are collected securely through Razorpay Checkout. Available methods may include UPI, debit and credit cards, and NetBanking, depending on your bank, device and Razorpay availability at checkout. Artiste does not ask you to share card, UPI PIN or banking passwords in chat.',
  'Artist Applications': 'Independent Artists can apply through the For Artiṣte portal. Create an account using your email, verify the sign-in link, then complete your Artist profile, studio pickup address and payout details. Submit your original works from the Artist Portal; listings are subject to Artiste review.',
  'Order Tracking': 'Sign in at For Cuṣtomers and open My Orders. Your order page shows the current order status and available courier or AWB tracking details. Tracking appears after the shipment is booked by the courier. For help with an order, contact Support with your order reference.',
};

function answerFor(message) {
  const q = message.toLowerCase();
  if (/damage|broken|crack|transit|unbox|packag|box/.test(q)) return answerByTopic['Packaging & Transit Damage'];
  if (/ship|deliver|dispatch|courier|how long|when.*arriv/.test(q)) return answerByTopic['Shipping & Delivery'];
  if (/pay|upi|card|net ?bank|razorpay|payment/.test(q)) return answerByTopic['Payment Methods'];
  if (/artist|apply|application|sell.*art|list.*painting|join/.test(q)) return answerByTopic['Artist Applications'];
  if (/track|awb|order|shipment|status/.test(q)) return answerByTopic['Order Tracking'];
  return 'I may not have the exact answer to that yet. Our Customer Support team can help directly. Use WhatsApp Support or Email Support below and include your order reference if your question is about a purchase.';
}

export default function ArtisteConcierge() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Welcome to Artiste. I can help with delivery, packaging, payments, Artist applications and order tracking. What would you like to know?' }]);
  const endRef = useRef(null);
  const whatsappUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent('Hello Artiste Support, I need help with: ')}`;
  const emailUrl = `mailto:${siteConfig.supportEmail}?subject=${encodeURIComponent('Artiste Customer Support')}`;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, open]);

  function ask(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;
    setMessages((current) => [...current, { from: 'user', text: cleaned }, { from: 'bot', text: answerFor(cleaned) }]);
    setInput('');
  }

  return (
    <div className="fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-3" aria-live="polite">
      {open && (
        <section className="flex max-h-[min(640px,calc(100vh-110px))] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[24px] border border-[#e1d5c7] bg-[#fffdf8] shadow-[0_24px_80px_rgba(40,35,31,.24)]" aria-label="Artiste Concierge chat">
          <header className="flex items-center justify-between bg-[#28231f] px-5 py-4 text-[#f8efe4]">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d6b797]/50 font-serif text-xl text-[#e8c6a8]">A</span><div><p className="font-serif text-xl leading-none">Artiste Concierge</p><p className="mt-1 text-[9px] uppercase tracking-[.16em] text-[#cbb9a4]">Here to help, thoughtfully</p></div></div>
            <button onClick={() => setOpen(false)} className="rounded-full p-2 text-[#e8d9c8] transition hover:bg-white/10" aria-label="Close Artiste Concierge"><X size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#faf6ef] p-4">
            {messages.map((message, index) => <div key={`${index}-${message.from}`} className={`flex ${message.from === 'user' ? 'justify-end' : 'justify-start'}`}><p className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-3 text-xs leading-6 ${message.from === 'user' ? 'rounded-br-md bg-[#a24d36] text-white' : 'rounded-bl-md border border-[#ece3d8] bg-white text-[#51483f]'}`}>{message.text}</p></div>)}
            <div ref={endRef} />
          </div>
          <div className="border-t border-[#e8dfd4] bg-[#fffdf8] p-4">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#88796b]">Quick help</p>
            <div className="mb-3 flex flex-wrap gap-1.5">{topics.map(({ label, icon: Icon }) => <button key={label} onClick={() => ask(label)} className="inline-flex items-center gap-1.5 rounded-full border border-[#e3d8ca] px-2.5 py-1.5 text-[9px] font-semibold text-[#65594d] transition hover:border-[#b77a61] hover:bg-[#f8f0e8]"><Icon size={11} /> {label}</button>)}</div>
            <form onSubmit={(event) => { event.preventDefault(); ask(input); }} className="flex gap-2">
              <input value={input} onChange={(event) => setInput(event.target.value)} className="field !rounded-full !py-2.5 !text-xs" placeholder="Ask Artiste Concierge…" aria-label="Ask Artiste Concierge" />
              <button type="submit" disabled={!input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#a24d36] text-white transition hover:bg-[#843e2c] disabled:opacity-40" aria-label="Send message"><Send size={15} /></button>
            </form>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eee6db] pt-3"><span className="text-[9px] text-[#8a7e72]">Need a person?</span><div className="flex gap-2"><a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#edf4ec] px-2.5 py-1.5 text-[9px] font-bold text-[#46634a]"><MessageCircle size={11} /> WhatsApp</a><a href={emailUrl} className="inline-flex items-center gap-1 rounded-full bg-[#f2ece4] px-2.5 py-1.5 text-[9px] font-bold text-[#74503f]"><Mail size={11} /> Email</a></div></div>
            <a href="/shipping-returns" className="mt-3 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[.12em] text-[#a24d36] hover:underline">Shipping &amp; Returns policy <ArrowUpRight size={11} /></a>
          </div>
        </section>
      )}
      <button onClick={() => setOpen((value) => !value)} className="group flex items-center gap-2 rounded-full border border-[#c6a68a] bg-[#28231f] px-4 py-3 text-white shadow-[0_10px_30px_rgba(40,35,31,.24)] transition hover:-translate-y-0.5 hover:bg-[#3a3029]" aria-expanded={open} aria-label={open ? 'Close Artiste Concierge' : 'Open Artiste Concierge'}>
        {open ? <X size={17} /> : <MessageCircle size={17} />}
        <span className="text-[10px] font-bold uppercase tracking-[.14em]">Artiste Concierge</span>
        {!open && <span className="h-1.5 w-1.5 rounded-full bg-[#d6ab82]" />}
      </button>
    </div>
  );
}
