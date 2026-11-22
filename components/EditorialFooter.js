import Link from 'next/link';
import { ArrowUpRight, Instagram, Mail, MapPin, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const phoneHref = `tel:${siteConfig.phoneNumber.replace(/[^+\d]/g, '')}`;
const whatsappHref = `https://wa.me/${siteConfig.whatsappNumber}`;

export default function EditorialFooter() {
  return (
    <footer className="site-chrome relative overflow-hidden border-t border-[#ded5c9] bg-[#f1eadf] text-[#28231f]">
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full border border-[#c8b39a]/35" />
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-[1.15fr_.85fr_1fr] md:px-10 md:py-16">
        <div>
          <Link href="/" className="inline-flex items-center gap-3" aria-label="Artiste home">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#a24d36]/45 font-serif text-2xl text-[#a24d36]">A</span>
            <span><b className="block font-serif text-3xl leading-none">Artiste</b><small className="mt-1 block text-[8px] uppercase tracking-[.27em] text-[#897d70]">The Indian art house</small></span>
          </Link>
          <p className="mt-5 max-w-sm text-sm leading-7 text-[#74695e]">Artiste — Original Paintings &amp; Fine-Art Photography, Delivered With Love From Independent Indian Studios to Your Home.</p>
          <a href={siteConfig.instagramUrl} target="_blank" rel="noreferrer" aria-label="Visit Artiste on Instagram" className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#cbbdae] text-[#8c4a37] transition hover:-translate-y-0.5 hover:bg-[#fffaf3]"><Instagram size={17} strokeWidth={1.7} /></a>
        </div>

        <div>
          <p className="eyebrow">Explore Artiste</p>
          <nav className="mt-5 grid gap-3 text-sm text-[#62584e]">
            <Link href="/#gallery" className="w-fit transition hover:text-[#a24d36]">Gallery <ArrowUpRight className="ml-1 inline" size={12} /></Link>
            <Link href="/artists" className="w-fit transition hover:text-[#a24d36]">Our Artists</Link>
            <Link href="/photography" className="w-fit transition hover:text-[#a24d36]">Fine-Art Photography</Link>
            <Link href="/#story" className="w-fit transition hover:text-[#a24d36]">Our Story</Link>
            <Link href="/account" className="w-fit transition hover:text-[#a24d36]">For Cuṣtomers</Link>
            <Link href="/artist" className="w-fit transition hover:text-[#a24d36]">For Creators — Painters &amp; Photographers</Link>
            <Link href="/shipping-returns" className="w-fit transition hover:text-[#a24d36]">Shipping &amp; Returns</Link>
          </nav>
        </div>

        <div>
          <p className="eyebrow">Customer Support &amp; Contact Us</p>
          <p className="mt-5 text-sm leading-6 text-[#74695e]">Questions about an artwork, delivery or an order? We would be glad to help.</p>
          <div className="mt-4 grid gap-3 text-sm text-[#62584e]">
            <a href={`mailto:${siteConfig.supportEmail}`} className="inline-flex w-fit items-center gap-2 transition hover:text-[#a24d36]"><Mail size={15} /> {siteConfig.supportEmail}</a>
            <a href={phoneHref} className="inline-flex w-fit items-center gap-2 transition hover:text-[#a24d36]"><Phone size={15} /> {siteConfig.phoneNumber}</a>
            <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 transition hover:text-[#a24d36]"><MessageCircle size={15} /> WhatsApp Support</a>
          </div>
          <Link href="/shipping-returns" className="mt-5 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#a24d36] hover:underline"><ShieldCheck size={14} /> Read our delivery promise <ArrowUpRight size={13} /></Link>
        </div>
      </div>

      <div className="border-t border-[#dcd1c3] px-5 py-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-[9px] uppercase tracking-[.14em] text-[#887c70] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Artiste. All rights reserved.</span>
          <span className="font-medium normal-case tracking-[.08em] text-[#76695c]">{siteConfig.foundersCredit}</span>
        </div>
      </div>
    </footer>
  );
}
