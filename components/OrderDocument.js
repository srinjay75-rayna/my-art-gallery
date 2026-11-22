"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, FileText, Printer, ShieldCheck } from 'lucide-react';
import siteConfig from '@/lib/siteConfig';
import { getBrowserSupabase } from '@/lib/supabase-browser';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
const amountInr = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function underThousand(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  let out = '';
  if (n >= 100) { out += `${ones[Math.floor(n / 100)]} Hundred`; n %= 100; if (n) out += ' '; }
  if (n >= 20) { out += tens[Math.floor(n / 10)]; if (n % 10) out += ` ${ones[n % 10]}`; }
  else if (n > 0) out += ones[n];
  return out;
}
function indianNumberWords(value) {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (!n) return 'Zero';
  const parts = [];
  const scales = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];
  for (const [size, label] of scales) {
    if (n >= size) { const count = Math.floor(n / size); parts.push(`${underThousand(count)} ${label}`); n %= size; }
  }
  if (n) parts.push(underThousand(n));
  return parts.join(' ');
}
function amountWords(value) {
  const amount = Math.round(Number(value || 0) * 100) / 100;
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${indianNumberWords(rupees)}${paise ? ` and ${indianNumberWords(paise)} Paise` : ''} Only`;
}
function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

export default function OrderDocument({ mode = 'invoice' }) {
  const params = useParams();
  const orderId = String(params?.orderId || '');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const isPackingSlip = mode === 'packing-slip';

  useEffect(() => {
    let active = true;
    async function load() {
      setBusy(true); setError('');
      try {
        let token = '';
        try {
          const { data: sessionData } = await getBrowserSupabase().auth.getSession();
          token = sessionData.session?.access_token || '';
        } catch {}
        const response = await fetch(`/api/order-documents/${encodeURIComponent(orderId)}${isPackingSlip ? '?mode=packing-slip' : ''}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not load this document.');
        if (active) setData(result);
      } catch (err) { if (active) setError(err.message); }
      finally { if (active) setBusy(false); }
    }
    if (orderId) load();
    return () => { active = false; };
  }, [orderId]);

  function printDocument() { window.print(); }

  if (busy) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-10 text-center"><ShieldCheck className="mx-auto text-clay" size={28}/><p className="mt-3 font-display text-2xl">Preparing your Artiste document…</p></div></main>;
  if (error || !data?.order) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-2xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-8"><p className="eyebrow">Artiste documents</p><h1 className="mt-2 font-display text-3xl">Document unavailable</h1><p className="mt-3 text-sm text-red-800">{error || 'This order document could not be found.'}</p><a href="/account" className="btn-secondary mt-6 inline-flex items-center gap-2"><ArrowLeft size={14}/> Return to account</a></div></main>;

  const { order, items = [], shipments = [], role } = data;
  const number = order.bill_number || `BOS-AR-${String(order.merchant_order_ref || order.id).replace(/[^a-zA-Z0-9-]/g, '')}`;
  const courierText = (role === 'artist' ? order.courier_name : [...new Set(shipments.map((s) => s.courier_name).filter(Boolean))].join(' · ')) || order.courier_name || 'To be assigned';
  const customerAddress = [order.shipping_address, order.landmark, order.locality, order.city, order.state, order.pincode].filter(Boolean).join(', ');
  const displayItems = isPackingSlip && role === 'artist' && shipments[0]?.items?.length ? shipments[0].items : items;
  const displayShipping = shipments.reduce((sum, s) => sum + Number(s.shipping_amount || 0), 0);
  const invoiceShipping = Number(order.shipping_amount ?? displayShipping);
  const invoiceTotal = Number(order.total_amount || (Number(order.artwork_price || 0) + invoiceShipping));
  const packing = shipments[0] || null;

  return <main className="paper-grain min-h-screen px-4 py-7 md:px-8">
    <div className="no-print mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3">
      <a href={role === 'artist' ? '/artist' : role === 'owner' ? '/studio-vault-owner' : '/account'} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14}/> Back to {role === 'artist' ? 'Artist Portal' : role === 'owner' ? 'Owner Centre' : 'My Orders'}</a>
      <button onClick={printDocument} className="btn-primary inline-flex items-center gap-2"><Download size={15}/>{isPackingSlip ? 'Print Shipping Packing Slip' : 'Download / Print Official Bill (PDF)'}</button>
    </div>

    {isPackingSlip ? <article className="document-sheet mx-auto max-w-4xl rounded-2xl border border-[#ded4c7] bg-white p-7 text-[#25211e] shadow-soft md:p-10">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b-2 border-[#28231f] pb-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#a24d36] font-display text-2xl text-[#a24d36]">A</span><div><p className="font-display text-3xl">Artiste</p><p className="text-[10px] uppercase tracking-[.18em] text-[#74685e]">Studio dispatch packing slip</p></div></div><div className="text-right text-xs leading-5"><b>Order: {order.merchant_order_ref || order.id}</b><p>Paid: {dateTime(order.paid_at || order.created_at)}</p><p className="font-bold text-green-800">PAYMENT PAID</p></div></div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2"><section><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Pickup from Artist studio</p><p className="mt-2 font-semibold">{packing?.artist_name || 'Artiste Artist'}</p><p className="text-sm leading-6">{[packing?.pickup_contact_name, packing?.pickup_phone, packing?.pickup_address, packing?.pickup_landmark, packing?.pickup_locality, packing?.pickup_city, packing?.pickup_state, packing?.pickup_pincode].filter(Boolean).join(', ')}</p><p className="mt-2 text-xs text-[#74685e]">Shiprocket location: {packing?.pickup_location || 'Not specified'}</p></section><section><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Deliver to Customer</p><p className="mt-2 font-semibold">{order.customer_name}</p><p className="text-sm leading-6">{order.customer_phone}<br/>{order.customer_email}<br/>{customerAddress}</p></section></div>
      <div className="mt-6 rounded-xl border border-[#d9d0c5] p-4"><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-[9px] uppercase tracking-widest text-[#74685e]">Delivery mode</p><p className="mt-1 text-sm font-semibold">{packing?.courier_name || 'To be arranged'}</p></div><div><p className="text-[9px] uppercase tracking-widest text-[#74685e]">AWB / Tracking</p><p className="mt-1 break-all text-sm font-semibold">{packing?.awb_code || packing?.shiprocket_shipment_id || (/Local delivery|Studio pickup/i.test(packing?.shipment_status || '') ? 'Not applicable — local arrangement / studio collection' : packing?.shipment_status || 'Not applicable yet')}</p></div><div><p className="text-[9px] uppercase tracking-widest text-[#74685e]">Parcel</p><p className="mt-1 text-sm font-semibold">{packing ? `${packing.package_weight_kg} kg · ${packing.package_length_cm} × ${packing.package_breadth_cm} × ${packing.package_height_cm} cm` : '—'}</p></div></div><p className="mt-3 text-xs text-[#74685e]">Shipment status: {packing?.shipment_status || 'Pending'}</p></div>
      <table className="mt-6 w-full border-collapse text-left text-sm"><thead><tr className="border-y border-[#bdb2a4] text-[10px] uppercase tracking-wider"><th className="py-3">Sl.</th><th className="py-3">Artwork to dispatch</th><th className="py-3 text-right">Qty</th></tr></thead><tbody>{displayItems.map((item, index) => <tr key={item.id || index} className="border-b border-[#e7e0d7]"><td className="py-3">{index + 1}</td><td className="py-3"><b>{item.title || 'Original artwork'}</b><p className="text-xs text-[#74685e]">{item.artist_name || packing?.artist_name || ''} · {item.medium || ''} · {item.dimensions || ''}</p></td><td className="py-3 text-right">1</td></tr>)}</tbody></table>
      <p className="mt-8 border-t border-[#e7e0d7] pt-4 text-center text-[10px] uppercase tracking-[.16em] text-[#74685e]">Handle with care · Original artwork · Artiste</p>
    </article> : <article className="document-sheet mx-auto max-w-5xl rounded-2xl border border-[#ded4c7] bg-white p-7 text-[#25211e] shadow-soft md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b-2 border-[#28231f] pb-6"><div className="flex items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#a24d36] font-display text-3xl text-[#a24d36]">A</span><div><h1 className="font-display text-3xl">{siteConfig.companyName}</h1><p className="mt-1 text-sm font-semibold">Bill of Supply / Retail Invoice</p><p className="mt-1 max-w-md text-xs leading-5 text-[#61574f]">{siteConfig.headOfficeAddress}</p><p className="text-xs text-[#61574f]">{siteConfig.supportEmail} · {siteConfig.phoneNumber}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a5a47]">{siteConfig.gstStatus} · Non-GST Bill of Supply</p></div></div><div className="min-w-[220px] text-right"><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Official document</p><p className="mt-1 break-all font-semibold">{number}</p><p className="mt-2 text-xs">Order date: {dateTime(order.created_at)}</p><p className="text-xs">Paid at: {dateTime(order.paid_at || order.created_at)}</p><p className="mt-2 inline-block rounded-full bg-green-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800">Payment status: PAID</p></div></header>
      <div className="mt-6 grid gap-5 md:grid-cols-2"><section className="rounded-xl bg-[#f8f4ed] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Billed to / Customer</p><p className="mt-2 font-semibold">{order.customer_name}</p><p className="text-xs leading-5">{order.customer_phone}<br/>{order.customer_email}</p></section><section className="rounded-xl bg-[#f8f4ed] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Delivery address</p><p className="mt-2 text-xs leading-5">{customerAddress}</p><p className="mt-2 text-xs"><b>Courier / Shipping mode:</b> {courierText}</p></section></div>
      <div className="mt-5 rounded-xl border border-[#e7e0d7] px-4 py-3 text-xs"><b>Razorpay payment reference:</b> <span className="break-all">{order.razorpay_payment_id || 'Not available'}</span></div>
      <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-left text-sm"><thead><tr className="border-y-2 border-[#bdb2a4] bg-[#f4efe7] text-[10px] uppercase tracking-wider"><th className="p-3">Sl. No.</th><th className="p-3">Artwork Description &amp; Artist</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit Rate (₹)</th><th className="p-3 text-right">Amount (₹)</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id || index} className="border-b border-[#e7e0d7]"><td className="p-3">{index + 1}</td><td className="p-3"><b>{item.title}</b><p className="mt-1 text-xs text-[#74685e]">{item.creator_role === 'Photographer' ? 'Photographer' : 'Artist'} · {item.artist_name} · {item.category === 'Photography' ? 'Fine-Art Photography' : 'Original Painting'} · {item.medium}{item.dimensions ? ` · ${item.dimensions}` : ''}{item.edition_details ? ` · ${item.edition_details}` : ''}{item.print_details ? ` · ${item.print_details}` : ''}</p></td><td className="p-3 text-right">{Number(item.quantity || 1)}</td><td className="p-3 text-right">{amountInr(item.price)}</td><td className="p-3 text-right">{amountInr(item.price)}</td></tr>)}</tbody><tfoot><tr className="border-b border-[#e7e0d7]"><td className="p-3" colSpan="4">Artwork subtotal</td><td className="p-3 text-right">{amountInr(order.artwork_price)}</td></tr><tr className="border-b border-[#e7e0d7]"><td className="p-3" colSpan="4">Shipping &amp; Handling Charges (₹)</td><td className="p-3 text-right">{amountInr(invoiceShipping)}</td></tr><tr className="border-b border-[#e7e0d7]"><td className="p-3" colSpan="4">Tax / GST (₹0.00 — Non-GST)</td><td className="p-3 text-right">0.00</td></tr><tr className="bg-[#f4efe7] text-base font-bold"><td className="p-3" colSpan="4">Grand Total Paid (₹)</td><td className="p-3 text-right">{amountInr(invoiceTotal)}</td></tr></tfoot></table></div>
      {shipments.length > 0 && <section className="mt-6"><h2 className="font-display text-xl">Shiprocket shipping breakdown</h2><table className="mt-2 w-full border-collapse text-sm"><thead><tr className="border-y border-[#bdb2a4] text-[10px] uppercase tracking-wider"><th className="p-2 text-left">Pickup studio / courier</th><th className="p-2 text-left">Shipment / AWB</th><th className="p-2 text-right">Shipping (₹)</th></tr></thead><tbody>{shipments.map((shipment, index) => <tr key={shipment.id || index} className="border-b border-[#e7e0d7]"><td className="p-2"><b>{shipment.artist_name || 'Creator studio'}</b><p className="text-xs text-[#74685e]">{shipment.courier_name || 'Courier / local arrangement'} · {shipment.shipment_status || 'Pending'}</p></td><td className="p-2 break-all text-xs">{shipment.awb_code || shipment.shiprocket_shipment_id || 'Awaiting dispatch'}</td><td className="p-2 text-right">{amountInr(shipment.shipping_amount)}</td></tr>)}</tbody><tfoot><tr className="bg-[#f4efe7] font-semibold"><td className="p-2" colSpan="2">Total shipping collected</td><td className="p-2 text-right">{amountInr(invoiceShipping)}</td></tr></tfoot></table></section>}
      <div className="mt-5 rounded-xl bg-[#f8f4ed] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-[#8a5a47]">Amount in words</p><p className="mt-2 text-sm font-semibold">{amountWords(invoiceTotal)}</p></div>
      <footer className="mt-9 flex flex-wrap items-end justify-between gap-5 border-t border-[#e7e0d7] pt-5 text-xs text-[#61574f]"><div><p className="font-semibold">Thank you for collecting original art.</p><p className="mt-1">This is a computer-generated non-GST Bill of Supply; no signature is required.</p><p className="mt-1">For support: {siteConfig.supportEmail} · {siteConfig.phoneNumber}</p></div><div className="text-right"><p className="font-display text-lg">Artiste</p><p className="text-[9px] uppercase tracking-widest">Where Every Canvas Carries a Soul · Love & Human Connection Across India</p></div></footer>
    </article>}
    <style jsx global>{`@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print, .site-chrome { display: none !important; } main { min-height: 0 !important; padding: 0 !important; background: #fff !important; } .document-sheet { max-width: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; } a { color: inherit !important; text-decoration: none !important; } }`}</style>
  </main>;
}
