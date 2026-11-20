"use client";

import { useMemo, useState } from 'react';

const inr = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));

const blankBuyer = { name: '', email: '', phone: '', address: '', city: '', state: '', pincode: '' };

function ArtworkImage({ src, title }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center bg-gradient-to-br from-[#e8d9c5] via-[#d8bda0] to-[#b47a60] text-center">
        <div className="max-w-[190px] border border-white/50 px-6 py-9 text-white/90">
          <span className="block font-display text-3xl">R</span>
          <span className="mt-2 block text-[9px] uppercase tracking-[.25em]">Artwork image</span>
          <span className="mt-1 block text-sm">{title}</span>
        </div>
      </div>
    );
  }
  return <img src={src} alt={title} className="art-card-image h-full min-h-[300px] w-full object-cover" onError={() => setFailed(true)} />;
}

export default function GalleryClient({ paintings, galleryError }) {
  const [selected, setSelected] = useState(null);
  const [buyer, setBuyer] = useState(blankBuyer);
  const [rates, setRates] = useState([]);
  const [chosenRate, setChosenRate] = useState(null);
  const [step, setStep] = useState('details');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const total = useMemo(() => Number(selected?.price || 0) + Number(chosenRate?.rate || 0), [selected, chosenRate]);

  function openBuy(painting) {
    setSelected(painting);
    setBuyer(blankBuyer);
    setRates([]);
    setChosenRate(null);
    setStep('details');
    setBusy(false);
    setMessage('');
    setError('');
    setSuccess(false);
  }

  function closeModal() {
    if (busy) return;
    setSelected(null);
  }

  function updateBuyer(event) {
    setBuyer((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function fetchRates(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/shipping-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paintingId: selected.id, deliveryPincode: buyer.pincode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not fetch courier options.');
      if (!result.couriers?.length) throw new Error('No courier service is available for this PIN code.');
      setRates(result.couriers);
      setChosenRate(result.couriers[0]);
      setStep('shipping');
    } catch (err) {
      setError(err.message || 'Something went wrong while checking delivery.');
    } finally {
      setBusy(false);
    }
  }

  async function beginPayment() {
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paintingId: selected.id, buyer, courierId: chosenRate.courier_company_id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to start payment.');
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load. Refresh the page and try again.');

      const checkout = new window.Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency || 'INR',
        name: 'Rangrekha Art Gallery',
        description: selected.title,
        image: '/favicon.ico',
        order_id: result.orderId,
        prefill: { name: buyer.name, email: buyer.email, contact: buyer.phone },
        notes: { painting_id: String(selected.id), courier: chosenRate.courier_name },
        theme: { color: '#a24d36' },
        handler: async (paymentResponse) => {
          setBusy(true);
          setMessage('Verifying payment and arranging your shipment…');
          try {
            const verifyResponse = await fetch('/api/verify-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(paymentResponse),
            });
            const verified = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verified.error || 'Payment verification failed.');
            setSuccess(true);
            setMessage(verified.message || 'Payment received. Your artwork is now reserved for delivery.');
          } catch (err) {
            setError(err.message || 'Payment was received, but confirmation needs attention. Please contact the gallery with your payment ID.');
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setMessage('Checkout closed. No payment confirmation was received.') },
      });
      checkout.on('payment.failed', (failure) => {
        setError(failure?.error?.description || 'Payment failed. You can try again.');
      });
      checkout.open();
    } catch (err) {
      setError(err.message || 'Unable to start payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="paper-grain min-h-screen overflow-hidden">
      <div className="border-b border-[#e8dfd2] bg-[#28231f] px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[.22em] text-[#ead8bd]">
        Original works · Carefully packed · Delivered across India
      </div>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 md:px-10">
        <a href="#top" className="flex items-center gap-3" aria-label="Rangrekha home">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#a24d36]/40 font-display text-xl text-clay">R</span>
          <span><span className="block font-display text-[22px] leading-none tracking-tight">rangrekha</span><span className="mt-1 block text-[8px] uppercase tracking-[.27em] text-muted">The Indian art house</span></span>
        </a>
        <nav className="hidden items-center gap-8 text-[11px] font-bold uppercase tracking-[.16em] text-[#655c52] md:flex">
          <a href="#gallery" className="transition hover:text-clay">The collection</a>
          <a href="#story" className="transition hover:text-clay">Our story</a>
          <a href="/admin" className="transition hover:text-clay">Artist / Admin</a>
        </nav>
        <a href="#gallery" className="rounded-full border border-[#d9cfc1] px-4 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#51483f]">Explore art <span className="ml-2">↘</span></a>
      </header>

      <section id="top" className="relative mx-auto grid max-w-7xl gap-10 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-10 md:pb-28 md:pt-12">
        <div className="relative z-10">
          <p className="mb-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.28em] text-clay"><span className="h-px w-9 bg-clay" /> Art with a sense of place</p>
          <h1 className="max-w-[690px] font-display text-[54px] leading-[.99] tracking-[-.055em] text-ink sm:text-7xl md:text-[86px]">A little more <em className="font-normal text-clay">soul</em> for your walls.</h1>
          <p className="mt-7 max-w-md text-[15px] leading-7 text-muted">A considered collection of original Indian paintings, made to be lived with, loved, and passed on.</p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <a href="#gallery" className="btn-primary">Explore the collection <span aria-hidden="true">↗</span></a>
            <span className="text-[10px] uppercase tracking-[.16em] text-muted">One original. One owner.</span>
          </div>
          <div className="mt-16 flex items-center gap-9 border-t border-[#ded5c9] pt-6">
            <div><p className="font-display text-2xl">01</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Original works</p></div>
            <div className="h-8 w-px bg-[#ded5c9]" />
            <div><p className="font-display text-2xl">IN</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Made in India</p></div>
            <div className="h-8 w-px bg-[#ded5c9]" />
            <div><p className="font-display text-2xl">∞</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Stories to keep</p></div>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[520px] md:ml-auto">
          <div className="absolute -right-5 -top-7 h-36 w-36 rounded-full border border-[#cba878]/50" />
          <div className="absolute -bottom-8 -left-7 h-48 w-48 rounded-full bg-[#e8d9c5]/70" />
          <div className="relative aspect-[4/5] overflow-hidden border-[12px] border-[#fffdf8] bg-[#dcc6ac] shadow-soft">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_25%,rgba(255,246,219,.72),transparent_42%),linear-gradient(145deg,#b77b5b_0%,#dfc49e_42%,#87907b_100%)]" />
            <div className="absolute left-[18%] top-[13%] h-[68%] w-[63%] rotate-[-5deg] border-[9px] border-[#f4e8d3] bg-[#6d4437] shadow-2xl">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,#e7b77c_0%,#b66e4e_24%,transparent_25%),radial-gradient(ellipse_at_32%_72%,#d9bd88_0%,#d9bd88_18%,transparent_19%),linear-gradient(125deg,#52655a,#8e684e_55%,#d7a76b)]" />
              <div className="absolute bottom-[12%] left-[14%] h-[42%] w-[25%] rounded-t-full bg-[#3d5148]/80" />
              <div className="absolute bottom-[9%] right-[15%] h-[48%] w-[22%] rounded-t-full bg-[#604336]/80" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/25 to-transparent" />
            <span className="absolute bottom-5 left-6 text-[9px] uppercase tracking-[.25em] text-white">Art that feels like home</span>
          </div>
          <div className="absolute -bottom-7 -right-2 rotate-3 bg-[#fffdf8] px-5 py-4 shadow-soft md:-right-8"><p className="font-display text-xl italic text-clay">Made to matter.</p><p className="mt-1 text-[8px] uppercase tracking-[.22em] text-muted">A Rangrekha selection</p></div>
        </div>
      </section>

      <section id="gallery" className="bg-[#eee7dc] px-5 py-20 md:px-10 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div><p className="mb-3 text-[10px] font-bold uppercase tracking-[.25em] text-clay">The gallery</p><h2 className="font-display text-5xl tracking-[-.04em] md:text-6xl">Find your <em className="font-normal text-clay">forever</em> piece.</h2></div>
            <p className="max-w-xs text-sm leading-6 text-muted">Every artwork is an original. Once it finds a home, it leaves the collection.</p>
          </div>
          {galleryError ? (
            <div className="rounded-2xl border border-[#dfc5b8] bg-[#fffaf5] p-7 text-sm text-[#8e4938]">{galleryError}</div>
          ) : paintings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cfc2b1] bg-[#f8f4ed] px-6 py-16 text-center"><p className="font-display text-3xl">A blank canvas, for now.</p><p className="mt-3 text-sm text-muted">New works will appear here as soon as they are added to the gallery.</p><a className="mt-6 inline-block text-xs font-bold uppercase tracking-[.15em] text-clay underline underline-offset-4" href="/admin">Open the artist studio</a></div>
          ) : (
            <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
              {paintings.map((painting, index) => (
                <article key={painting.id} className="art-card group overflow-hidden bg-[#fffdf8] shadow-[0_8px_34px_rgba(55,42,30,.045)]">
                  <div className="relative overflow-hidden bg-[#e2d6c8]"><ArtworkImage src={painting.image_url} title={painting.title} /><span className="absolute left-4 top-4 bg-[#fffdf8]/90 px-3 py-1.5 text-[8px] font-bold uppercase tracking-[.2em] text-[#574d43]">No. {String(index + 1).padStart(2, '0')}</span></div>
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4"><div><h3 className="font-display text-2xl leading-tight">{painting.title}</h3><p className="mt-2 text-[11px] uppercase tracking-[.12em] text-muted">{painting.medium || 'Original artwork'}</p></div><p className="whitespace-nowrap text-sm font-bold text-clay">{inr(painting.price)}</p></div>
                    <div className="mt-5 flex items-center justify-between border-t border-[#eee7dc] pt-4"><span className="text-[10px] text-muted">{painting.dimensions || 'Unique dimensions'}</span><button onClick={() => openBuy(painting)} className="btn-primary !px-5 !py-2.5 !text-[10px]">Buy now <span>↗</span></button></div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="story" className="mx-auto grid max-w-7xl gap-8 px-5 py-20 md:grid-cols-2 md:items-center md:px-10 md:py-24">
        <div className="relative min-h-[300px] overflow-hidden bg-[#d4b995] p-10 md:min-h-[390px]">
          <div className="absolute -left-12 -top-20 h-72 w-72 rounded-full border border-[#fff4df]/60" />
          <div className="absolute bottom-[-100px] right-[-40px] h-72 w-72 rounded-full bg-[#a24d36]/30" />
          <div className="relative flex h-full min-h-[220px] flex-col justify-between"><span className="font-display text-7xl text-[#fff8ed]">“</span><p className="max-w-sm font-display text-3xl leading-snug text-[#fff8ed]">A painting is not just something you see. It is something you feel.</p><span className="text-[9px] uppercase tracking-[.25em] text-[#fff8ed]/80">The Rangrekha thought</span></div>
        </div>
        <div className="py-4 md:pl-10"><p className="mb-4 text-[10px] font-bold uppercase tracking-[.25em] text-clay">A note from us</p><h2 className="font-display text-5xl leading-[1.05] tracking-[-.04em]">Art should be <em className="font-normal text-clay">personal.</em></h2><p className="mt-6 max-w-lg text-sm leading-7 text-muted">Rangrekha brings original works closer to the people who connect with them. We believe in the quiet joy of finding a piece that belongs in your space, reflects your story, and makes an everyday moment feel special.</p><a href="#gallery" className="mt-8 inline-flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.18em] text-clay">Meet the collection <span>↗</span></a></div>
      </section>

      <footer className="bg-[#28231f] px-5 py-9 text-[#e8ddce] md:px-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 md:flex-row md:items-center"><div><p className="font-display text-2xl">rangrekha</p><p className="mt-1 text-[9px] uppercase tracking-[.2em] text-[#aa9a86]">The Indian art house</p></div><p className="text-xs text-[#aa9a86]">Original art. Thoughtfully chosen. © {new Date().getFullYear()} Rangrekha.</p><a href="/admin" className="text-[10px] uppercase tracking-[.17em] text-[#e8ddce]">Studio login ↗</a></div></footer>

      {selected && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-[#f9f6f0] shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#e7dfd4] px-6 py-5 sm:px-8"><div><p className="text-[9px] font-bold uppercase tracking-[.22em] text-clay">Secure artwork checkout</p><h3 className="mt-1 font-display text-2xl">{success ? 'Thank you for choosing original art.' : selected.title}</h3></div><button onClick={closeModal} disabled={busy} className="rounded-full border border-[#ded5c9] px-3 py-1 text-lg text-muted disabled:opacity-40" aria-label="Close">×</button></div>
            <div className="px-6 py-6 sm:px-8">
              {success ? (
                <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e5eee3] text-3xl text-[#47684b]">✓</div><p className="mt-5 font-display text-3xl">Payment received</p><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{message}</p><p className="mt-5 text-xs text-muted">A confirmation and delivery update will follow using the contact details you provided.</p><button onClick={() => setSelected(null)} className="btn-primary mt-7">Back to gallery</button></div>
              ) : (
                <>
                  <div className="mb-6 flex items-center justify-between gap-4 rounded-xl bg-[#eee7dc] p-4"><div><p className="font-display text-lg">{selected.title}</p><p className="mt-1 text-[10px] uppercase tracking-[.13em] text-muted">{selected.medium} · {selected.dimensions}</p></div><p className="whitespace-nowrap font-semibold text-clay">{inr(selected.price)}</p></div>
                  <div className="mb-6 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.16em] text-muted"><span className={step === 'details' ? 'text-clay' : 'text-[#8c8378]'}>01 Your details</span><span className="h-px flex-1 bg-[#ded5c9]"/><span className={step === 'shipping' ? 'text-clay' : 'text-[#8c8378]'}>02 Delivery</span><span className="h-px flex-1 bg-[#ded5c9]"/><span>03 Payment</span></div>
                  {step === 'details' ? (
                    <form onSubmit={fetchRates} className="grid gap-4 sm:grid-cols-2">
                      <label className="sm:col-span-2"><span className="label">Full name</span><input className="field" name="name" autoComplete="name" value={buyer.name} onChange={updateBuyer} required maxLength={100} placeholder="Your name" /></label>
                      <label><span className="label">Email</span><input className="field" type="email" name="email" autoComplete="email" value={buyer.email} onChange={updateBuyer} required placeholder="you@example.com" /></label>
                      <label><span className="label">Phone</span><input className="field" type="tel" name="phone" autoComplete="tel" value={buyer.phone} onChange={updateBuyer} required minLength={10} maxLength={15} placeholder="10-digit mobile number" /></label>
                      <label className="sm:col-span-2"><span className="label">Address</span><textarea className="field min-h-[78px] resize-y" name="address" autoComplete="street-address" value={buyer.address} onChange={updateBuyer} required maxLength={250} placeholder="House / flat, street, locality" /></label>
                      <label><span className="label">City</span><input className="field" name="city" autoComplete="address-level2" value={buyer.city} onChange={updateBuyer} required maxLength={80} placeholder="City" /></label>
                      <label><span className="label">State</span><input className="field" name="state" autoComplete="address-level1" value={buyer.state} onChange={updateBuyer} required maxLength={80} placeholder="State" /></label>
                      <label><span className="label">6-digit PIN code</span><input className="field" inputMode="numeric" name="pincode" autoComplete="postal-code" value={buyer.pincode} onChange={updateBuyer} required pattern="[0-9]{6}" maxLength={6} placeholder="e.g. 700001" /></label>
                      <div className="sm:col-span-2">{error && <p className="mb-3 rounded-lg bg-[#f9e8e3] px-4 py-3 text-xs text-[#9a3d2c]">{error}</p>}<button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Checking courier availability…' : 'Check delivery options'} <span>→</span></button></div>
                    </form>
                  ) : (
                    <div>
                      <div className="mb-4 grid gap-2">
                        {rates.map((rate) => (
                          <label key={rate.courier_company_id} className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4 transition ${chosenRate?.courier_company_id === rate.courier_company_id ? 'border-clay bg-[#f5eae2]' : 'border-[#e2d9ce] bg-white'}`}>
                            <span className="flex items-center gap-3"><input type="radio" name="courier" checked={chosenRate?.courier_company_id === rate.courier_company_id} onChange={() => setChosenRate(rate)} className="accent-[#a24d36]"/><span><span className="block text-sm font-semibold">{rate.courier_name}</span><span className="mt-1 block text-[10px] text-muted">Estimated delivery: {rate.etd || 'As per courier schedule'}</span></span></span><span className="font-semibold text-clay">{inr(rate.rate)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="rounded-xl bg-[#28231f] p-5 text-[#f7f3ec]"><div className="flex justify-between text-xs text-[#c5b7a5]"><span>Artwork</span><span>{inr(selected.price)}</span></div><div className="mt-3 flex justify-between text-xs text-[#c5b7a5]"><span>Delivery</span><span>{inr(chosenRate?.rate)}</span></div><div className="mt-4 flex justify-between border-t border-white/15 pt-4"><span className="font-display text-xl">Total payable</span><span className="text-xl font-semibold">{inr(total)}</span></div></div>
                      {error && <p className="mt-4 rounded-lg bg-[#f9e8e3] px-4 py-3 text-xs text-[#9a3d2c]">{error}</p>}
                      {message && <p className="mt-4 text-xs text-muted">{message}</p>}
                      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button className="btn-secondary" onClick={() => { setStep('details'); setError(''); setMessage(''); }}>Edit address</button><button className="btn-primary" onClick={beginPayment} disabled={busy || !chosenRate}>{busy ? 'Opening secure checkout…' : 'Pay securely'} <span>↗</span></button></div>
                      <p className="mt-4 text-center text-[9px] leading-5 text-muted">Payments are processed securely by Razorpay. Courier rates are live quotes and may change before order creation; the server rechecks the selected courier at checkout.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
