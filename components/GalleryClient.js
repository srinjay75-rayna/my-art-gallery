"use client";
import { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const emptyProfile = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
function ArtImage({ src, title }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img src={src} alt={title} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" onError={() => setBad(true)} /> : <div className="flex h-full min-h-[280px] items-center justify-center bg-gradient-to-br from-[#e8d9c5] via-[#d8bda0] to-[#b47a60]"><div className="border border-white/50 px-7 py-10 text-center text-white"><b className="font-display text-5xl">A</b><p className="mt-2 text-[9px] uppercase tracking-[.2em]">Artiste original</p><p className="mt-2 text-sm">{title}</p></div></div>;
}
function ArtCard({ painting, onDetails, onAdd, onBuy, onArtistFilter }) {
  return <article className="art-card group overflow-hidden rounded-[22px] border border-[#e7ded2] bg-[#fffdf8] shadow-[0_10px_35px_rgba(65,48,32,.045)]">
    <button className="block w-full overflow-hidden bg-[#e9ddce] text-left" onClick={() => onDetails(painting)} aria-label={`View ${painting.title}`}><div className="aspect-[4/4.7] overflow-hidden"><ArtImage src={painting.image_url} title={painting.title} /></div></button>
    <div className="p-5"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-clay">{painting.medium}</p><button onClick={() => onDetails(painting)} className="mt-2 text-left font-display text-2xl leading-tight hover:text-clay">{painting.title}</button><p className="mt-2 text-xs text-muted">{painting.dimensions}</p><p className="mt-3 text-xs text-muted">Created by <button onClick={() => onArtistFilter(painting.artist_name || 'Artiste Studio')} className="font-semibold text-clay underline-offset-4 hover:underline">{painting.artist_name || 'Artiste Studio'}</button></p>
      <div className="mt-4 flex items-center justify-between border-t border-[#eee6db] pt-4"><b className="font-display text-2xl">{inr(painting.price)}</b><span className="pill">Original work</span></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onAdd(painting)} className="btn-secondary !px-2 !py-3 text-[9px]">Add to cart</button><button onClick={() => onBuy(painting)} className="btn-primary !px-2 !py-3 text-[9px]">Buy now ↗</button></div>
    </div>
  </article>;
}

export default function GalleryClient({ paintings = [], galleryError = '' }) {
  const [cart, setCart] = useState([]);
  const [drawer, setDrawer] = useState(false);
  const [detail, setDetail] = useState(null);
  const [artistFilter, setArtistFilter] = useState('All artists');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [gateStep, setGateStep] = useState('');
  const [pendingIntent, setPendingIntent] = useState(null);
  const [rates, setRates] = useState([]);
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    try {
      const supabase = getBrowserSupabase();
      const acceptSession = (value) => {
        if (value && !hasEmailOtpSession(value)) { setSession(null); setTimeout(() => supabase.auth.signOut(), 0); return; }
        setSession(value || null);
      };
      supabase.auth.getSession().then(({ data }) => acceptSession(data.session || null));
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => acceptSession(nextSession));
      return () => subscription.unsubscribe();
    } catch (err) { setError(err.message); }
  }, []);

  const artists = useMemo(() => ['All artists', ...Array.from(new Set(paintings.map((p) => p.artist_name || 'Artiste Studio'))).sort((a, b) => a.localeCompare(b))], [paintings]);
  const visible = useMemo(() => artistFilter === 'All artists' ? paintings : paintings.filter((p) => (p.artist_name || 'Artiste Studio') === artistFilter), [paintings, artistFilter]);
  const subtotal = cart.reduce((sum, painting) => sum + Number(painting.price || 0), 0);
  const shipping = Object.values(chosen).reduce((sum, option) => sum + Number(option?.rate || 0), 0);
  const total = subtotal + shipping;

  async function fetchCustomerProfile(currentSession) {
    const response = await fetch('/api/account', { headers: { Authorization: `Bearer ${currentSession.access_token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load Customer details.');
    const next = { ...emptyProfile, ...(data.profile || {}) };
    setProfile(next);
    return next;
  }

  function addPendingArtwork(intent) {
    if (!intent) return;
    if (intent.type === 'buy') setCart([intent.painting]);
    else setCart((current) => current.some((p) => String(p.id) === String(intent.painting.id)) ? current : [...current, intent.painting]);
    setRates([]); setChosen({}); setSuccess(false); setMessage(''); setGateStep('cart'); setPendingIntent(null);
  }

  async function startCartIntent(painting, type) {
    setDrawer(true); setError(''); setMessage(''); setRates([]); setChosen({}); setSuccess(false);
    setPendingIntent({ painting, type });
    let currentSession = session;
    if (currentSession && !hasEmailOtpSession(currentSession)) {
      await getBrowserSupabase().auth.signOut();
      currentSession = null;
      setSession(null);
    }
    if (!currentSession) {
      try {
        const { data } = await getBrowserSupabase().auth.getSession();
        currentSession = data.session && hasEmailOtpSession(data.session) ? data.session : null;
        if (data.session && !currentSession) await getBrowserSupabase().auth.signOut();
        if (currentSession) setSession(currentSession);
      } catch { currentSession = null; }
    }
    if (!currentSession) { setGateStep('auth'); return; }
    try {
      const customerProfile = await fetchCustomerProfile(currentSession);
      const isComplete = customerProfile.full_name && customerProfile.phone && customerProfile.address && customerProfile.landmark && customerProfile.locality && customerProfile.city && customerProfile.state && /^\d{6}$/.test(String(customerProfile.pincode || ''));
      if (isComplete) addPendingArtwork({ painting, type });
      else setGateStep('details');
    } catch (err) { setError(err.message); setGateStep('details'); }
  }

  async function onCustomerVerified(newSession) {
    setSession(newSession);
    try {
      const customerProfile = await fetchCustomerProfile(newSession);
      const isComplete = customerProfile.full_name && customerProfile.phone && customerProfile.address && customerProfile.landmark && customerProfile.locality && customerProfile.city && customerProfile.state && /^\d{6}$/.test(String(customerProfile.pincode || ''));
      if (isComplete) addPendingArtwork(pendingIntent);
      else setGateStep('details');
    } catch (err) { setError(err.message); setGateStep('details'); }
  }

  async function saveCustomerDetails(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(profile) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save shipping details.');
      setProfile({ ...emptyProfile, ...data.profile });
      setMessage('Shipping details saved. Your basket is ready.');
      addPendingArtwork(pendingIntent);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function updateProfile(patch) { setProfile((current) => ({ ...current, ...patch })); if (patch.pincode !== undefined) { setRates([]); setChosen({}); } }
  function removeItem(id) { setCart((current) => current.filter((p) => String(p.id) !== String(id))); setRates([]); setChosen({}); }

  async function fetchRates(event) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      if (!session) throw new Error('Verify your email as a Customer before checking delivery rates.');
      const response = await fetch('/api/shipping-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items: cart.map((p) => ({ paintingId: p.id })), deliveryPincode: profile.pincode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not fetch courier rates.');
      if (!data.groups?.length || data.groups.some((group) => !group.couriers?.length)) throw new Error('No courier service is available for one or more Artist pickup locations.');
      setRates(data.groups);
      setChosen(Object.fromEntries(data.groups.map((group) => [group.groupKey, group.couriers[0]])));
      setMessage(`Live Shiprocket options are ready for ${data.groups.length} Artist pickup location(s).`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function checkout() {
    setError(''); setBusy(true);
    try {
      if (!session) throw new Error('Please verify your email to continue.');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
      if (!rates.length || rates.some((group) => !chosen[group.groupKey])) throw new Error('Choose a courier for every Artist pickup location.');
      const couriers = rates.map((group) => ({ groupKey: group.groupKey, courierId: chosen[group.groupKey].courier_company_id, quotedRate: chosen[group.groupKey].rate }));
      const response = await fetch('/api/create-order', { method: 'POST', headers, body: JSON.stringify({ items: cart.map((p) => ({ paintingId: p.id })), couriers }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start payment.');
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load. Refresh and try again.');
      const checkoutInstance = new window.Razorpay({
        key: data.keyId, amount: data.amount, currency: data.currency || 'INR', name: 'Artiste', description: `${cart.length} original artwork(s)`,
        image: '/favicon.ico', order_id: data.orderId, prefill: { name: profile.full_name, email: session.user.email, contact: profile.phone },
        notes: { item_count: String(cart.length), courier_groups: String(rates.length) }, theme: { color: '#a24d36' },
        handler: async (payment) => {
          setBusy(true); setMessage('Verifying payment and arranging your shipment…');
          try {
            const verification = await fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payment) });
            const result = await verification.json();
            if (!verification.ok) throw new Error(result.error || 'Payment verification failed.');
            setSuccess(true); setMessage(result.message || 'Payment received.'); setCart([]); setRates([]); setChosen({}); setGateStep('cart');
          } catch (err) { setError(err.message); }
          finally { setBusy(false); }
        },
        modal: { ondismiss: () => setMessage('Checkout closed. No payment confirmation was received.') },
      });
      checkoutInstance.on('payment.failed', (failure) => setError(failure?.error?.description || 'Payment failed. Please try again.'));
      checkoutInstance.open();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function closeDrawer() { if (!busy) { setDrawer(false); setError(''); setMessage(''); setGateStep(''); setPendingIntent(null); } }

  return <main className="paper-grain min-h-screen overflow-hidden">
    <div className="bg-[#28231f] px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[.22em] text-[#ead8bd]">Original works · Carefully packed · Delivered across India</div>
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 md:px-10"><a href="#top" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#a24d36]/40 font-display text-xl text-clay">A</span><span><b className="block font-display text-[22px] leading-none">Artiste</b><small className="mt-1 block text-[8px] uppercase tracking-[.27em] text-muted">The Indian art house</small></span></a><nav className="hidden items-center gap-7 text-[10px] font-bold uppercase tracking-[.15em] text-[#655c52] md:flex"><a href="#gallery" className="hover:text-clay">Collection</a><a href="#artists" className="hover:text-clay">For Artists</a><a href="/account" className="hover:text-clay">For Cuṣtomers</a></nav><div className="flex items-center gap-2"><a href="/account" className="rounded-full border border-[#d9cfc1] px-3 py-2 text-[9px] font-bold uppercase tracking-wider">Account</a><button onClick={() => { setDrawer(true); setGateStep('cart'); }} className="rounded-full bg-ink px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white">Cart ({cart.length})</button></div></header>

    <section id="top" className="relative mx-auto grid max-w-7xl gap-10 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-10 md:pb-28 md:pt-12"><div className="relative z-10"><p className="mb-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.28em] text-clay"><span className="h-px w-9 bg-clay"/> Art with a sense of place</p><h1 className="max-w-[690px] font-display text-[54px] leading-[.99] tracking-[-.055em] text-ink sm:text-7xl md:text-[86px]">A little more <em className="font-normal text-clay">soul</em> for your walls.</h1><p className="mt-7 max-w-md text-[15px] leading-7 text-muted">A considered collection of original Indian art, made to be lived with, loved, and passed on.</p><div className="mt-9 flex flex-wrap items-center gap-5"><a href="#gallery" className="btn-primary">Explore the collection ↗</a><span className="text-[10px] uppercase tracking-[.16em] text-muted">One original. One owner.</span></div><div className="mt-16 flex items-center gap-9 border-t border-[#ded5c9] pt-6"><div><p className="font-display text-2xl">01</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Original works</p></div><div className="h-8 w-px bg-[#ded5c9]"/><div><p className="font-display text-2xl">IN</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Made in India</p></div><div className="h-8 w-px bg-[#ded5c9]"/><div><p className="font-display text-2xl">∞</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Stories to keep</p></div></div></div>
      <div className="relative mx-auto w-full max-w-[520px] md:ml-auto"><div className="absolute -right-5 -top-7 h-36 w-36 rounded-full border border-[#cba878]/50"/><div className="absolute -bottom-8 -left-7 h-48 w-48 rounded-full bg-[#e8d9c5]/70"/><div className="relative aspect-[4/5] overflow-hidden border-[12px] border-[#fffdf8] bg-[#dcc6ac] shadow-soft"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_25%,rgba(255,246,219,.72),transparent_42%),linear-gradient(145deg,#b77b5b_0%,#dfc49e_42%,#87907b_100%)]"/><div className="absolute left-[18%] top-[13%] h-[68%] w-[63%] rotate-[-5deg] border-[9px] border-[#f4e8d3] bg-[#6d4437] shadow-2xl"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,#e7b77c_0%,#b66e4e_24%,transparent_25%),radial-gradient(ellipse_at_32%_72%,#d9bd88_0%,#d9bd88_18%,transparent_19%),linear-gradient(125deg,#52655a,#8e684e_55%,#d7a76b)]"/><div className="absolute bottom-[12%] left-[14%] h-[42%] w-[25%] rounded-t-full bg-[#3d5148]/80"/><div className="absolute bottom-[9%] right-[15%] h-[48%] w-[22%] rounded-t-full bg-[#604336]/80"/></div><div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/25 to-transparent"/><span className="absolute bottom-7 left-7 font-display text-2xl italic text-white">Art that stays.</span></div><div className="absolute -bottom-7 -right-2 rotate-3 bg-[#fffdf8] px-5 py-4 shadow-soft md:-right-8"><p className="font-display text-xl italic text-clay">Made to matter.</p><p className="mt-1 text-[8px] uppercase tracking-[.22em] text-muted">An Artiste selection</p></div></div>
    </section>

    <section id="gallery" className="mx-auto max-w-7xl px-5 py-16 md:px-10"><div className="mb-10 flex flex-wrap items-end justify-between gap-5"><div><p className="eyebrow">The collection</p><h2 className="mt-3 font-display text-5xl tracking-tight">Find your <em className="font-normal text-clay">one original.</em></h2><p className="mt-3 max-w-xl text-sm text-muted">Thoughtfully selected works by independent Indian Artists.</p></div><label className="label">Browse by Artist<select className="field mt-2 min-w-48" value={artistFilter} onChange={(e) => setArtistFilter(e.target.value)}>{artists.map((artist) => <option key={artist}>{artist}</option>)}</select></label></div>
      {galleryError && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{galleryError}</p>}
      {!galleryError && visible.length > 0 && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visible.map((painting) => <ArtCard key={painting.id} painting={painting} onDetails={setDetail} onAdd={(p) => startCartIntent(p, 'add')} onBuy={(p) => startCartIntent(p, 'buy')} onArtistFilter={(name) => { setArtistFilter(name); document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }); }} />)}</div>}
      {!galleryError && !visible.length && <div className="rounded-3xl border border-dashed border-[#cfc2b1] p-14 text-center"><p className="font-display text-3xl">The next original is on its way.</p><p className="mt-2 text-sm text-muted">There are no available works in this collection yet.</p></div>}
    </section>

    <section id="artists" className="mx-auto max-w-7xl px-5 pb-20 md:px-10"><div className="rounded-[30px] bg-[#28231f] p-8 text-[#f8efe4] md:p-12"><p className="eyebrow !text-[#c5a98b]">For Artiṣte <span className="cedilla-mark">¸</span></p><div className="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-end"><div><h2 className="max-w-2xl font-display text-4xl leading-tight md:text-5xl">Are You an Artist? Exhibit &amp; Sell Original Works on Artiste.</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-[#d8cbbd]">Join a thoughtfully curated collective, introduce your practice to new collectors and let your original work find its next home.</p></div><a href="/artist" className="btn-primary whitespace-nowrap">Apply to join our curated collective ↗</a></div></div></section>
    <footer className="border-t border-[#ded5c9] px-5 py-8 text-center text-[9px] uppercase tracking-[.2em] text-muted">© {new Date().getFullYear()} Artiste · Original Indian Art · For Artists · For Customers</footer>

    {detail && <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}><section className="grid max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-[#fffdf8] shadow-2xl md:grid-cols-2" onClick={(e) => e.stopPropagation()}><div className="min-h-[300px] bg-[#e9ddce]"><ArtImage src={detail.image_url} title={detail.title} /></div><div className="overflow-y-auto p-6 md:p-9"><div className="flex items-start justify-between"><p className="eyebrow">Original Artiste work</p><button onClick={() => setDetail(null)} className="text-xl text-muted" aria-label="Close details">×</button></div><h2 className="mt-4 font-display text-4xl">{detail.title}</h2><p className="mt-3 text-sm text-muted">{detail.medium} · {detail.dimensions}</p><p className="mt-5 text-sm">Created by <button className="font-semibold text-clay underline-offset-4 hover:underline" onClick={() => { setArtistFilter(detail.artist_name || 'Artiste Studio'); setDetail(null); document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }); }}>{detail.artist_name || 'Artiste Studio'}</button></p><p className="mt-5 font-display text-3xl">{inr(detail.price)}</p><p className="mt-4 text-xs leading-6 text-muted">An original, one-of-a-kind work. Once sold, this piece will be removed from the available collection.</p><div className="mt-7 grid grid-cols-2 gap-2"><button className="btn-secondary" onClick={() => { setDetail(null); startCartIntent(detail, 'add'); }}>Add to cart</button><button className="btn-primary" onClick={() => { setDetail(null); startCartIntent(detail, 'buy'); }}>Buy now ↗</button></div></div></section></div>}

    {drawer && <div className="fixed inset-0 z-[60] flex justify-end"><button className="modal-backdrop absolute inset-0 cursor-default" onClick={closeDrawer} aria-label="Close cart"/><aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[#faf6ef] p-5 shadow-2xl md:p-7"><div className="flex items-center justify-between border-b border-[#ded5c9] pb-4"><div><p className="eyebrow">Your Artiste basket</p><h2 className="mt-1 font-display text-3xl">Cart <span className="text-clay">({cart.length})</span></h2></div><button onClick={closeDrawer} className="text-2xl text-muted" aria-label="Close cart">×</button></div>
      {gateStep === 'auth' && <div className="mt-6"><p className="mb-4 text-sm leading-6 text-muted">Please verify your email as a Customer before adding original works to your basket.</p><EmailOtpAuth accountType="customer" onVerified={onCustomerVerified} /></div>}
      {gateStep === 'details' && <div className="mt-6"><p className="mb-4 text-sm leading-6 text-muted">Save your complete delivery details before checkout. PIN lookup suggests locality, district and State / UT automatically.</p><form onSubmit={saveCustomerDetails} className="grid gap-4 rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-5"><IndianAddressForm value={profile} onChange={updateProfile} showContact /><button disabled={busy} className="btn-primary w-full">{busy ? 'Saving…' : 'Save Customer details & continue'} ↗</button></form></div>}
      {gateStep === 'cart' && <>
        {success && <div className="mt-5 rounded-2xl bg-green-50 p-4"><p className="font-semibold text-green-900">Payment successful</p><p className="mt-1 text-sm text-green-800">Your order has been recorded as Paid.</p><a href="/account" className="mt-3 inline-block text-xs font-bold text-green-900 underline">View My Orders ↗</a></div>}
        <div className="mt-5 flex-1">{cart.map((painting) => <article key={painting.id} className="mb-3 flex gap-3 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-3"><img src={painting.image_url} alt={painting.title} className="h-24 w-20 rounded-xl object-cover"/><div className="min-w-0 flex-1"><b className="font-display text-xl">{painting.title}</b><p className="mt-1 text-xs text-muted">Created by {painting.artist_name || 'Artiste Studio'}</p><p className="mt-2 font-semibold">{inr(painting.price)}</p></div><button onClick={() => removeItem(painting.id)} className="self-start text-[10px] font-bold uppercase text-clay">Remove</button></article>)}
          {!cart.length && !success && <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-10 text-center"><p className="font-display text-2xl">Your cart is waiting.</p><p className="mt-2 text-sm text-muted">Return to the gallery to discover an original work.</p></div>}
        </div>
        {cart.length > 0 && <>
          <div className="mt-4 border-t border-[#e5dccf] pt-4"><div className="flex justify-between text-sm"><span>Artwork subtotal</span><b>{inr(subtotal)}</b></div>{rates.length > 0 && <div className="mt-2 flex justify-between text-sm"><span>Delivery · {rates.length} Artist pickup location(s)</span><b>{inr(shipping)}</b></div>}<div className="mt-3 flex justify-between border-t border-[#e5dccf] pt-3 font-semibold"><span>Total</span><span className="text-clay">{inr(total)}</span></div></div>
          <div className="mt-4 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-4"><p className="eyebrow">Delivering to</p><p className="mt-2 text-sm font-semibold">{profile.full_name} · +91 {profile.phone}</p><p className="mt-1 text-xs leading-5 text-muted">{profile.address}, {profile.landmark}, {profile.locality}, {profile.city}, {profile.state} — {profile.pincode}</p><a href="/account" className="mt-2 inline-block text-[10px] font-bold uppercase tracking-wider text-clay underline">Edit in My Details</a></div>
          <form onSubmit={fetchRates} className="mt-4"><button disabled={busy} className="btn-secondary w-full">{busy ? 'Checking…' : 'Calculate live Shiprocket rates'} ↻</button></form>
          {rates.length > 0 && <div className="mt-4"><h3 className="font-display text-2xl">Choose a courier for each Artist studio</h3><div className="mt-3 grid gap-4">{rates.map((group) => <section key={group.groupKey} className="rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><b className="font-display text-xl">{group.artistName}</b><p className="text-[10px] text-muted">{group.itemCount} artwork(s) from this Artist studio</p></div><span className="pill">Artist studio</span></div><div className="grid gap-2">{group.couriers.map((rate) => <label key={rate.courier_company_id} className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${chosen[group.groupKey]?.courier_company_id === rate.courier_company_id ? 'border-clay bg-[#f7eee6]' : 'border-[#e5dccf]'}`}><span className="flex items-center gap-2"><input type="radio" name={`courier-${group.groupKey}`} checked={chosen[group.groupKey]?.courier_company_id === rate.courier_company_id} onChange={() => setChosen((current) => ({ ...current, [group.groupKey]: rate }))} /><span><b className="block text-sm">{rate.courier_name}</b><small className="text-muted">{rate.etd || 'Delivery estimate unavailable'}</small></span></span><b>{inr(rate.rate)}</b></label>)}</div></section>)}</div><button onClick={checkout} disabled={busy || rates.some((group) => !chosen[group.groupKey])} className="btn-primary mt-4 w-full">{busy ? 'Processing…' : `Pay ${inr(total)} with Razorpay`} ↗</button><p className="mt-3 text-center text-[9px] leading-5 text-muted">Each Artist studio is quoted separately using its own pickup PIN and packed parcel. All selections are re-verified by Artiste before payment.</p></div>}
        </>}
      </>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && !success && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    </aside></div>}
  </main>;
}
