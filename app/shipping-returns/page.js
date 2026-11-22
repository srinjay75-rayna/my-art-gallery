import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock3, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';

export const metadata = {
  title: 'Shipping & Returns | Artiste',
  description: 'How Artiste packs, ships and protects original artworks across India.',
};

const steps = [
  { icon: Clock3, title: 'Dispatch in 2–4 business days', body: 'After payment confirmation, we prepare your original artwork for dispatch. Orders are generally handed to the courier within 2–4 business days. Delivery after dispatch depends on the destination and courier service.' },
  { icon: PackageCheck, title: 'Museum-grade protective packaging', body: 'Each artwork is carefully prepared using protective, artwork-appropriate packaging intended to help guard it against handling and movement during transit.' },
  { icon: Truck, title: 'Pan-India insured courier dispatch', body: 'We arrange Pan-India dispatch through Shiprocket with insured courier coverage, subject to the selected carrier’s terms, declared-value limits and claim documentation requirements. Tracking details are shared when the shipment is booked.' },
  { icon: ShieldCheck, title: '48-hour transit-damage protection', body: 'Please record a continuous unboxing video and inspect the artwork immediately after delivery. Report visible transit damage to support within 48 hours of delivery, with the video, clear photographs and your order reference.' },
];

export default function ShippingReturnsPage() {
  return (
    <main className="paper-grain min-h-screen px-5 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#B85D3B] hover:underline"><ArrowLeft size={14} /> Back to Gallery</Link>
        <div className="mt-8 max-w-3xl">
          <p className="eyebrow">A considered delivery promise</p>
          <h1 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">Shipping, care &amp; <em className="font-normal text-[#B85D3B]">returns.</em></h1>
          <p className="mt-6 text-sm leading-7 text-[#74695e] md:text-base">An original artwork deserves a thoughtful journey. Here is how Artiste prepares, dispatches and supports your purchase from our Artists’ studios to your door.</p>
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {steps.map(({ icon: Icon, title, body }, index) => <article key={title} className="rounded-[22px] border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-[0_8px_28px_rgba(65,48,32,.035)]"><div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f3e9dc] text-[#B85D3B]"><Icon size={19} strokeWidth={1.7} /></span><span className="font-display text-3xl text-[#d6c6b4]">0{index + 1}</span></div><h2 className="mt-5 font-display text-2xl">{title}</h2><p className="mt-3 text-sm leading-7 text-[#74695e]">{body}</p></article>)}
        </section>

        <section className="mt-8 rounded-[24px] border border-[#D9C6A6] bg-[#F3ECE1] p-6 md:p-8">
          <h2 className="font-display text-3xl">If your artwork arrives damaged</h2>
          <p className="mt-3 text-sm leading-7 text-[#74695e]">Our 48-hour unboxing-video protection helps us investigate transit damage promptly and raise the appropriate courier claim. Please follow these steps:</p>
          <ol className="mt-5 grid gap-3 text-sm leading-6 text-[#51483f]">
            <li className="flex gap-3"><CheckCircle2 className="mt-1 shrink-0 text-[#8b9a75]" size={17} /><span>Before opening, start one continuous video showing the sealed parcel and shipping label, then record the opening and the artwork clearly. Do not pause or edit the recording.</span></li>
            <li className="flex gap-3"><CheckCircle2 className="mt-1 shrink-0 text-[#8b9a75]" size={17} /><span>Keep the outer box, inner packaging and all protective materials until the matter is resolved.</span></li>
            <li className="flex gap-3"><CheckCircle2 className="mt-1 shrink-0 text-[#8b9a75]" size={17} /><span>Email <a className="font-semibold text-[#B85D3B] underline" href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a> within 48 hours of delivery with your order reference, the unboxing video and clear photographs of the parcel and damage.</span></li>
            <li className="flex gap-3"><CheckCircle2 className="mt-1 shrink-0 text-[#8b9a75]" size={17} /><span>Please do not attempt to repair, alter or dispose of the artwork or packaging while the claim is being reviewed. We will coordinate the review and next steps with the courier, subject to its insurance and claim requirements.</span></li>
          </ol>
        </section>

        <section className="mt-8 grid gap-6 rounded-[24px] bg-[#263832] p-6 text-[#f8efe4] md:grid-cols-[1fr_.75fr] md:p-8">
          <div><p className="eyebrow !text-[#c5a98b]">Original artworks</p><h2 className="mt-3 font-display text-3xl">A considered final sale.</h2><p className="mt-3 text-sm leading-7 text-[#d8cbbd]">Because each listed painting is an original, one-of-a-kind artwork, all artwork sales are final. We do not accept returns or exchanges for a change of mind, personal preference, size preference or differences in how colours appear on individual screens. This does not limit the transit-damage reporting process described above or any rights that cannot legally be excluded.</p></div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-[#c5a98b]">Need a hand?</p><p className="mt-3 text-sm leading-6 text-[#e8ddd1]">Our support team can help with a delivery query, tracking reference or damage report.</p><a href={`mailto:${siteConfig.supportEmail}`} className="mt-4 inline-flex rounded-full bg-[#f1dfcc] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#5d3a2c]">Email Customer Support</a></div>
        </section>

        <p className="mt-7 text-xs leading-6 text-[#8a7e72]">Courier availability, serviceability, transit timelines, declared-value limits and insurance claim outcomes can vary by PIN code and carrier. The policy should be read together with the shipping details displayed at checkout.</p>
      </div>
    </main>
  );
}
