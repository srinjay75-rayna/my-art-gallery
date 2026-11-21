import { MessageCircle, Phone } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

const phoneHref = `tel:${siteConfig.phoneNumber.replace(/[^+\d]/g, '')}`;
const whatsappHref = `https://wa.me/${siteConfig.whatsappNumber}`;

export default function ContactBar() {
  return (
    <div className="relative z-30 border-b border-[#4b4035] bg-[#28231f] text-[#f4e8d8]">
      <div className="mx-auto flex min-h-9 max-w-7xl items-center justify-end gap-5 px-5 py-1.5 text-[9px] font-semibold uppercase tracking-[.16em] md:px-10">
        <span className="mr-auto hidden text-[8px] tracking-[.2em] text-[#cbb9a4] sm:block">A considered Indian art house</span>
        <a href={phoneHref} className="inline-flex items-center gap-1.5 transition hover:text-white" aria-label={`Call Artiste at ${siteConfig.phoneNumber}`}>
          <Phone size={12} strokeWidth={1.8} /> <span>Call Us</span>
        </a>
        <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition hover:text-white" aria-label="WhatsApp Artiste Support">
          <MessageCircle size={13} strokeWidth={1.8} /> <span>WhatsApp Support</span>
        </a>
      </div>
    </div>
  );
}
