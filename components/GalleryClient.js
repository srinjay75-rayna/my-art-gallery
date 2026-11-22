"use client";
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, IndianRupee, MapPin, Palette, ShoppingBag, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';
import CulturalFeed from '@/components/CulturalFeed';

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const emptyProfile = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
function ArtImage({ src, title }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img src={src} alt={title} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" onError={() => setBad(true)} /> : <div className="flex h-full min-h-[280px] items-center justify-center bg-gradient-to-br from-[#e8d9c5] via-[#d8bda0] to-[#b47a60]"><div className="border border-white/50 px-7 py-10 text-center text-white"><b className="font-display text-5xl">A</b><p className="mt-2 text-[9px] uppercase tracking-[.2em]">Artiste original</p><p className="mt-2 text-sm">{title}</p></div></div>;
}
function ArtCard({ painting, onDetails, onAdd, onBuy, onArtistFilter }) {
  return <article className="art-card group overflow-hidden rounded-[22px] border border-[#D9C6A6] bg-[#F3ECE1] shadow-[0_10px_35px_rgba(65,48,32,.045)]">
    <button className="block w-full overflow-hidden bg-[#e9ddce] text-left" onClick={() => onDetails(painting)} aria-label={`View ${painting.title}`}><div className="aspect-[4/4.7] overflow-hidden"><ArtImage src={painting.image_url} title={painting.title} /></div></button>
    <div className="p-5"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-clay">{painting.medium}</p><button onClick={() => onDetails(painting)} className="mt-2 text-left font-display text-2xl leading-tight hover:text-clay">{painting.title}</button><p className="mt-2 text-xs text-muted">{painting.dimensions}</p>{painting.category === 'Photography' && (painting.edition_details || painting.print_details) && <p className="mt-1 text-[10px] text-muted">{[painting.edition_details, painting.print_details].filter(Boolean).join(' · ')}</p>}<div className="mt-3 flex items-center gap-2 text-xs text-muted"><span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e7d8c7] bg-[#f3e9dd]">{painting.avatar_url ? <img src={painting.avatar_url} alt={`${painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photographer' : 'Artist')} profile`} className="h-full w-full object-cover" loading="lazy"/> : <UserRound size={14} className="text-clay"/>}</span><span>{painting.creator_role === 'Photographer' ? 'Photographed by' : 'Created by'} <button onClick={() => onArtistFilter(painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio'))} className="font-semibold text-clay underline-offset-4 hover:underline">{painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio')}</button></span></div>
      <div className="mt-4 flex items-center justify-between border-t border-[#eee6db] pt-4"><b className="font-display text-2xl">{inr(painting.price)}</b><span className="pill">{painting.category === 'Photography' ? 'Fine-Art Photography' : 'Original Painting'}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onAdd(painting)} className="btn-secondary inline-flex items-center justify-center gap-1 !px-2 !py-3 text-[9px]"><ShoppingBag size={13}/> Add to cart</button><button onClick={() => onBuy(painting)} className="btn-primary inline-flex items-center justify-center gap-1 !px-2 !py-3 text-[9px]">Buy now <ArrowUpRight size={13}/></button></div>
    </div>
  </article>;
}

export default function GalleryClient({ paintings = [], artists = [], galleryError = '', pageMode = 'home', initialCategory = 'All Works', collectionArtistName = '' }) {
  const [cart, setCart] = useState([]);
  const [drawer, setDrawer] = useState(false);
  const [detail, setDetail] = useState(null);
  const [selectedArtist, setSelectedArtist] = useState('All');
  const [artFilter, setArtFilter] = useState(initialCategory);
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
        if (value && (!hasEmailOtpSession(value) || value.user?.user_metadata?.account_type === 'artist')) { setSession(null); setTimeout(() => supabase.auth.signOut(), 0); return; }
        setSession(value || null);
      };
      supabase.auth.getSession().then(({ data }) => acceptSession(data.session || null));
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => acceptSession(nextSession));
      return () => subscription.unsubscribe();
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => {
    const openCart = () => { setDrawer(true); setGateStep('cart'); };
    window.addEventListener('artiste:open-cart', openCart);
    try {
      if (window.sessionStorage.getItem('artiste:open-cart') === '1') {
        window.sessionStorage.removeItem('artiste:open-cart');
        openCart();
      }
    } catch {}
    return () => window.removeEventListener('artiste:open-cart', openCart);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function resumePending() {
      let pending;
      try { pending = JSON.parse(localStorage.getItem('artiste_pending_cart') || 'null'); } catch { pending = null; }
      if (!pending?.painting?.id) return;
      try {
        const customerProfile = await fetchCustomerProfile(session);
        const isComplete = customerProfile.full_name && customerProfile.phone && customerProfile.address && customerProfile.landmark && customerProfile.locality && customerProfile.city && customerProfile.state && /^\d{6}$/.test(String(customerProfile.pincode || ''));
        if (cancelled) return;
        if (!isComplete) { window.location.assign('/account/onboarding'); return; }
        setCart((current) => pending.type === 'buy' ? [pending.painting] : (current.some((p) => String(p.id) === String(pending.painting.id)) ? current : [...current, pending.painting]));
        setRates([]); setChosen({}); setDrawer(true); setGateStep('cart'); setPendingIntent(null);
        localStorage.removeItem('artiste_pending_cart');
      } catch (err) { if (!cancelled) setError(err.message); }
    }
    resumePending();
    return () => { cancelled = true; };
  }, [session]);

  const creatorRoleById = useMemo(() => new Map(artists.map((creator) => [String(creator.id), creator.creator_role === 'Photographer' ? 'Photographer' : 'Painter'])), [artists]);
  const creatorRoleByName = useMemo(() => new Map(artists.map((creator) => [String(creator.artist_name || '').trim().toLocaleLowerCase(), creator.creator_role === 'Photographer' ? 'Photographer' : 'Painter'])), [artists]);
  const categoryFiltered = useMemo(() => {
    if (artFilter === 'Paintings') {
      return paintings.filter((painting) => {
        const role = painting.creator_role || creatorRoleById.get(String(painting.artist_id || '')) ||
          creatorRoleByName.get(String(painting.artist_name || '').trim().toLocaleLowerCase()) || 'Painter';
        return painting.category !== 'Photography' && role === 'Painter';
      });
    }
    if (artFilter === 'Photography') {
      return paintings.filter((painting) => {
        const role = painting.creator_role || creatorRoleById.get(String(painting.artist_id || '')) ||
          creatorRoleByName.get(String(painting.artist_name || '').trim().toLocaleLowerCase()) ||
          (painting.category === 'Photography' ? 'Photographer' : 'Painter');
        return painting.category === 'Photography' && role === 'Photographer';
      });
    }
    return paintings;
  }, [paintings, artFilter, creatorRoleById, creatorRoleByName]);
  // Derive the dropdown from the active category so a creator only appears
  // when they actually have a work in the currently selected collection.
  const artistOptions = useMemo(() => [
    'All',
    ...Array.from(new Set(categoryFiltered.map((painting) => painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio'))))
      .sort((a, b) => a.localeCompare(b)),
  ], [categoryFiltered]);
  const visible = useMemo(() => selectedArtist === 'All'
    ? categoryFiltered
    : categoryFiltered.filter((painting) => (painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio')) === selectedArtist),
  [categoryFiltered, selectedArtist]);
  const photographyWorks = useMemo(() => paintings.filter((painting) => painting.category === 'Photography'), [paintings]);
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
    try { localStorage.removeItem('artiste_pending_cart'); } catch {}
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
    if (!currentSession) {
      try { localStorage.setItem('artiste_pending_cart', JSON.stringify({ painting, type })); } catch {}
      setGateStep('auth'); return;
    }
    try {
      const customerProfile = await fetchCustomerProfile(currentSession);
      const isComplete = customerProfile.full_name && customerProfile.phone && customerProfile.address && customerProfile.landmark && customerProfile.locality && customerProfile.city && customerProfile.state && /^\d{6}$/.test(String(customerProfile.pincode || ''));
      if (isComplete) addPendingArtwork({ painting, type });
      else { try { localStorage.setItem('artiste_pending_cart', JSON.stringify({ painting, type })); } catch {} window.location.assign('/account/onboarding'); }
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
      setChosen(Object.fromEntries(data.groups.map((group) => [group.groupKey, group.couriers[0] || null])));
      setMessage(`Delivery options are ready for ${data.groups.length} Artist pickup location(s). The lowest-priced option is selected automatically.`);
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
        notes: { item_count: String(cart.length), courier_groups: String(rates.length) }, theme: { color: '#B85D3B' },
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
    {pageMode !== 'collection' && <div className="bg-[#263832] px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[.22em] text-[#ead8bd]">Original works · Carefully packed · Delivered across India</div>}

    {pageMode === 'home' ? <section id="top" className="relative mx-auto grid max-w-7xl gap-10 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-10 md:pb-28 md:pt-12"><div className="relative z-10"><p className="mb-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.28em] text-clay"><span className="h-px w-9 bg-clay"/> Art with a sense of place</p><h1 className="max-w-[690px] font-display text-[54px] leading-[.99] tracking-[-.055em] text-ink sm:text-7xl md:text-[86px]">A little more <em className="font-normal text-clay">soul</em> for your walls.</h1><p className="mt-7 max-w-xl text-[15px] leading-7 text-muted">Artiste — Where Indian Heritage Meets Modern Walls. Every painting &amp; photograph carries a human heartbeat — curated from independent studios and delivered with love.</p><div className="mt-9 flex flex-wrap items-center gap-5"><a href="#collection" onClick={(event) => { event.preventDefault(); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="btn-primary inline-flex items-center gap-2">Explore the collection <ArrowUpRight size={15}/></a></div><div className="mt-16 flex items-center gap-9 border-t border-[#D9C6A6] pt-6"><div><p className="font-display text-2xl">01</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Original works</p></div><div className="h-8 w-px bg-[#D9C6A6]"/><div><p className="font-display text-2xl">IN</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Made in India</p></div><div className="h-8 w-px bg-[#D9C6A6]"/><div><p className="font-display text-2xl">∞</p><p className="mt-1 text-[9px] uppercase tracking-[.15em] text-muted">Stories to keep</p></div></div></div><div className="relative mx-auto w-full max-w-[520px] md:ml-auto"><div className="absolute -right-5 -top-7 h-36 w-36 rounded-full border border-[#cba878]/50"/><div className="absolute -bottom-8 -left-7 h-48 w-48 rounded-full bg-[#e8d9c5]/70"/><div className="relative aspect-[4/5] overflow-hidden border-[12px] border-[#F3ECE1] bg-[#dcc6ac] shadow-soft"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_25%,rgba(255,246,219,.72),transparent_42%),linear-gradient(145deg,#b77b5b_0%,#dfc49e_42%,#87907b_100%)]"/><div className="absolute left-[18%] top-[13%] h-[68%] w-[63%] rotate-[-5deg] border-[9px] border-[#f4e8d3] bg-[#6d4437] shadow-2xl"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,#e7b77c_0%,#b66e4e_24%,transparent_25%),radial-gradient(ellipse_at_32%_72%,#d9bd88_0%,#d9bd88_18%,transparent_19%),linear-gradient(125deg,#52655a,#8e684e_55%,#d7a76b)]"/><div className="absolute bottom-[12%] left-[14%] h-[42%] w-[25%] rounded-t-full bg-[#3d5148]/80"/><div className="absolute bottom-[9%] right-[15%] h-[48%] w-[22%] rounded-t-full bg-[#604336]/80"/></div><div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/25 to-transparent"/><span className="absolute bottom-7 left-7 font-display text-2xl italic text-white">Art that stays.</span></div><div className="absolute -bottom-7 -right-2 rotate-3 bg-[#F3ECE1] px-5 py-4 shadow-soft md:-right-8"><p className="font-display text-xl italic text-clay">Made to matter.</p><p className="mt-1 text-[8px] uppercase tracking-[.22em] text-muted">An Artiste selection</p></div></div></section> : pageMode === 'photography' ? <section id="top" className="mx-auto max-w-7xl px-5 pb-10 pt-12 md:px-10 md:pb-14"><p className="eyebrow">The photographic wing</p><h1 className="mt-3 max-w-4xl font-display text-6xl tracking-tight md:text-7xl">Fine-Art <em className="font-normal text-clay">Photography.</em></h1><p className="mt-5 max-w-2xl text-sm leading-7 text-muted">A considered collection of original photographic works by independent Indian creators. Explore each image, process and point of view.</p></section> : null}
    {pageMode === 'home' && <section id="story" className="mx-auto grid max-w-7xl gap-6 px-5 pb-10 md:grid-cols-[.75fr_1.25fr] md:px-10"><div><p className="eyebrow flex items-center gap-2"><Sparkles size={13}/> Our Story</p><h2 className="mt-3 font-display text-4xl">Art made to <em className="font-normal text-clay">belong.</em></h2></div><p className="max-w-3xl text-sm leading-7 text-muted">Every painting &amp; photograph carries a human heartbeat — curated from independent studios and delivered with love. We celebrate the stories, places and practices behind each piece, and bring Indian heritage into the homes of thoughtful collectors.</p></section>}

    <section id="collection" className={`scroll-mt-24 mx-auto max-w-7xl px-5 ${pageMode === 'collection' ? 'py-8' : 'py-16'} md:px-10`}><span id="gallery" className="block scroll-mt-24" aria-hidden="true" /><div className="mb-8 flex flex-col gap-6"><div><p className="eyebrow flex items-center gap-2"><Palette size={14}/> The collection</p><h2 className="mt-3 font-display text-5xl tracking-tight">{pageMode === 'photography' ? <>Explore <em className="font-normal text-clay">Fine-Art Photography.</em></> : pageMode === 'collection' ? <>Original works by <em className="font-normal text-clay">{collectionArtistName}</em></> : <>Find your <em className="font-normal text-clay">one original.</em></>}</h2><p className="mt-3 max-w-xl text-sm text-muted">{pageMode === 'collection' ? 'Browse this creator’s available original paintings and fine-art photographs.' : 'Original paintings remain at the heart of Artiste, alongside a curated selection of fine-art photography.'}</p></div><div className="flex flex-wrap items-end justify-between gap-4"><div className="flex flex-wrap gap-2" role="group" aria-label="Filter by art form">{[{ value: 'All Works', label: 'All Works' }, { value: 'Paintings', label: 'Original Paintings' }, { value: 'Photography', label: 'Fine-Art Photography' }].map((option) => <button key={option.value} type="button" onClick={() => { setArtFilter(option.value); setSelectedArtist('All'); }} aria-pressed={artFilter === option.value} className={`rounded-full border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[.13em] transition ${artFilter === option.value ? 'border-[#263832] bg-[#263832] text-white' : 'border-[#d9cdbf] bg-[#F3ECE1] text-[#655c52] hover:border-clay hover:text-clay'}`}>{option.label}</button>)}</div><label className="label">Browse by Artist<select className="field mt-2 min-w-48" value={selectedArtist} onChange={(e) => setSelectedArtist(e.target.value)}>{artistOptions.map((artist) => <option key={artist} value={artist}>{artist === 'All' ? 'All artists' : artist}</option>)}</select></label></div></div>
      {galleryError && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{galleryError}</p>}
      {!galleryError && visible.length > 0 && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visible.map((painting) => <ArtCard key={painting.id} painting={painting} onDetails={setDetail} onAdd={(p) => startCartIntent(p, 'add')} onBuy={(p) => startCartIntent(p, 'buy')} onArtistFilter={(name) => { setSelectedArtist(name); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />)}</div>}
      {!galleryError && !visible.length && <div className="rounded-3xl border border-dashed border-[#cfc2b1] p-14 text-center"><p className="font-display text-3xl">The next original is on its way.</p><p className="mt-2 text-sm text-muted">There are no available works in this collection yet.</p></div>}
    </section>


    {pageMode === 'home' && photographyWorks.length > 0 && <section className="mx-auto max-w-7xl px-5 pb-16 md:px-10"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">A curated secondary wing</p><h2 className="mt-2 font-display text-4xl">Curated <em className="font-normal text-clay">Photography.</em></h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">Distinct perspectives and carefully selected photographic works from independent Indian creators.</p></div><a href="/photography" className="text-xs font-bold uppercase tracking-wider text-clay hover:underline">Explore all photography ↗</a></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photographyWorks.slice(0, 3).map((work) => <a href="/photography" key={work.id} className="group overflow-hidden rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1]"><div className="aspect-[5/4] overflow-hidden bg-[#e9ddce]"><img src={work.image_url} alt={work.title} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" loading="lazy"/></div><div className="p-4"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-clay">Fine-Art Photography</p><h3 className="mt-2 font-display text-2xl">{work.title}</h3><p className="mt-1 text-xs text-muted">By {work.artist_name || 'Artiste Studio'}</p></div></a>)}</div></section>}

    {pageMode === 'home' && <CulturalFeed onExploreCollection={(filter) => { setArtFilter(filter); setSelectedArtist('All'); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />}

    {pageMode === 'home' && artists.length > 0 && <section className="mx-auto max-w-7xl px-5 pb-16 md:px-10"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow flex items-center gap-2"><UserRound size={14}/> The people behind the art</p><h2 className="mt-3 font-display text-5xl">Meet Our <em className="font-normal text-clay">Artists.</em></h2><p className="mt-3 max-w-xl text-sm leading-6 text-muted">Independent painters and fine-art photographers, their studios and the stories behind their work.</p></div><a href="/artists" className="text-xs font-bold uppercase tracking-wider text-clay hover:underline">Meet all Artists ↗</a></div><div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-4">{artists.map((artist) => <a href={`/artists/${artist.id}`} key={artist.id} className="group rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 text-center transition hover:-translate-y-1 hover:shadow-soft"><span className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-full border-[5px] border-[#f0e5d8] bg-[#eadbca] font-display text-5xl text-clay">{artist.avatar_url ? <img src={artist.avatar_url} alt={artist.artist_name} className="h-full w-full object-cover"/> : (artist.artist_name || 'A').slice(0,1).toUpperCase()}</span><p className="mt-4 text-[9px] font-bold uppercase tracking-[.18em] text-clay">{artist.creator_role === 'Photographer' ? 'Photographer' : 'Painter'}</p><h3 className="mt-1 font-display text-2xl group-hover:text-clay">{artist.artist_name}</h3><p className="mt-1 text-[10px] uppercase tracking-widest text-muted">{[artist.city,artist.state].filter(Boolean).join(', ') || 'India'}</p><p className="mx-auto mt-3 line-clamp-3 max-w-xs text-xs leading-6 text-muted">{artist.bio || 'Discover this creator’s original practice and curated collection.'}</p></a>)}</div></section>}


    {pageMode === 'home' && <section id="artists" className="mx-auto max-w-7xl px-5 pb-20 md:px-10"><div className="rounded-[30px] bg-[#263832] p-8 text-[#f8efe4] md:p-12"><p className="eyebrow flex items-center gap-2 !text-[#c5a98b]"><Palette size={14}/> For Artists — Painters &amp; Photographers</p><div className="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-end"><div><h2 className="max-w-2xl font-display text-4xl leading-tight md:text-5xl">Are You a Painter or Fine-Art Photographer? Exhibit &amp; Sell Your Original Work on Artiste.</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-[#d8cbbd]">Join a thoughtfully curated collective, introduce your practice to new collectors and let your original work find its next home.</p></div><a href="/artist" className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap">Apply to join our curated collective <ArrowUpRight size={15}/></a></div></div></section>}

    {detail && <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}><section className="grid max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-[#F3ECE1] shadow-2xl md:grid-cols-2" onClick={(e) => e.stopPropagation()}><div className="min-h-[300px] bg-[#e9ddce]"><ArtImage src={detail.image_url} title={detail.title} /></div><div className="overflow-y-auto p-6 md:p-9"><div className="flex items-start justify-between"><p className="eyebrow">{detail.category === 'Photography' ? 'Original Fine-Art Photograph' : 'Original Artiste Painting'}</p><button onClick={() => setDetail(null)} className="rounded-full p-2 text-muted hover:bg-[#f2eadd]" aria-label="Close details"><X size={18}/></button></div><h2 className="mt-4 font-display text-4xl">{detail.title}</h2><p className="mt-3 text-sm text-muted">{detail.medium} · {detail.dimensions}</p>{detail.category === 'Photography' && (detail.edition_details || detail.print_details) && <p className="mt-2 text-xs text-muted">{[detail.edition_details, detail.print_details].filter(Boolean).join(' · ')}</p>}<div className="mt-5 flex items-center gap-3 text-sm"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e7d8c7] bg-[#f3e9dd]">{detail.avatar_url ? <img src={detail.avatar_url} alt={`${detail.artist_name || (detail.creator_role === 'Photographer' ? 'Photographer' : 'Artist')} profile`} className="h-full w-full object-cover"/> : <UserRound size={17} className="text-clay"/>}</span><span>{detail.creator_role === 'Photographer' ? 'Photographed by' : 'Created by'} <button className="font-semibold text-clay underline-offset-4 hover:underline" onClick={() => { setSelectedArtist(detail.artist_name || (detail.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio')); setDetail(null); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{detail.artist_name || 'Artiste Studio'}</button></span></div><p className="mt-5 font-display text-3xl">{inr(detail.price)}</p><p className="mt-4 text-xs leading-6 text-muted">A one-of-a-kind original work. Once sold, this piece will be removed from the available collection.</p><div className="mt-7 grid grid-cols-2 gap-2"><button className="btn-secondary inline-flex items-center justify-center gap-1" onClick={() => { setDetail(null); startCartIntent(detail, 'add'); }}><ShoppingBag size={14}/> Add to cart</button><button className="btn-primary inline-flex items-center justify-center gap-1" onClick={() => { setDetail(null); startCartIntent(detail, 'buy'); }}>Buy now <ArrowUpRight size={14}/></button></div></div></section></div>}

    {drawer && <div className="fixed inset-0 z-[60] flex justify-end"><button className="modal-backdrop absolute inset-0 cursor-default" onClick={closeDrawer} aria-label="Close cart"/><aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[#FAF6F0] p-5 shadow-2xl md:p-7"><div className="flex items-center justify-between border-b border-[#D9C6A6] pb-4"><div><p className="eyebrow">Your Artiste basket</p><h2 className="mt-1 font-display text-3xl">Cart <span className="text-clay">({cart.length})</span></h2></div><button onClick={closeDrawer} className="rounded-full p-2 text-muted hover:bg-[#f2eadd]" aria-label="Close cart"><X size={19}/></button></div>
      {gateStep === 'auth' && <div className="mt-6"><p className="mb-4 text-sm leading-6 text-muted">Please verify your email as a Customer before adding original works to your basket.</p><EmailOtpAuth accountType="customer" /></div>}
      {gateStep === 'details' && <div className="mt-6"><p className="mb-4 text-sm leading-6 text-muted">Save your complete delivery details before checkout. PIN lookup suggests locality, district and State / UT automatically.</p><form onSubmit={saveCustomerDetails} className="grid gap-4 rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-5"><IndianAddressForm value={profile} onChange={updateProfile} showContact /><button disabled={busy} className="btn-primary inline-flex w-full items-center justify-center gap-2">{busy ? 'Saving…' : 'Save Customer details & continue'} <ArrowUpRight size={15}/></button></form></div>}
      {gateStep === 'cart' && <>
        {success && <div className="mt-5 rounded-2xl bg-green-50 p-4"><p className="font-semibold text-green-900">Payment successful</p><p className="mt-1 text-sm text-green-800">Your order has been recorded as Paid.</p><a href="/account" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-green-900 underline">View My Orders <ArrowUpRight size={13}/></a></div>}
        <div className="mt-5 flex-1">{cart.map((painting) => <article key={painting.id} className="mb-3 flex gap-3 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-3"><img src={painting.image_url} alt={painting.title} className="h-24 w-20 rounded-xl object-cover"/><div className="min-w-0 flex-1"><b className="font-display text-xl">{painting.title}</b><p className="mt-1 text-xs text-muted">{painting.creator_role === 'Photographer' ? 'Photographed by' : 'Created by'} {painting.artist_name || (painting.creator_role === 'Photographer' ? 'Photography Studio' : 'Artist Studio')}</p><p className="mt-2 font-semibold">{inr(painting.price)}</p></div><button onClick={() => removeItem(painting.id)} className="self-start inline-flex items-center gap-1 text-[10px] font-bold uppercase text-clay"><X size={13}/> Remove</button></article>)}
          {!cart.length && !success && <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-10 text-center"><p className="font-display text-2xl">Your cart is waiting.</p><p className="mt-2 text-sm text-muted">Return to the gallery to discover an original work.</p></div>}
        </div>
        {cart.length > 0 && <>
          <div className="mt-4 border-t border-[#D9C6A6] pt-4"><div className="flex justify-between text-sm"><span>Artwork subtotal</span><b>{inr(subtotal)}</b></div>{rates.length > 0 && <div className="mt-2 flex justify-between text-sm"><span>Delivery · {rates.length} Artist pickup location(s)</span><b>{inr(shipping)}</b></div>}<div className="mt-3 flex justify-between border-t border-[#D9C6A6] pt-3 font-semibold"><span>Total</span><span className="text-clay">{inr(total)}</span></div></div>
          <div className="mt-4 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-4"><p className="eyebrow">Delivering to</p><p className="mt-2 text-sm font-semibold">{profile.full_name} · +91 {profile.phone}</p><p className="mt-1 text-xs leading-5 text-muted">{profile.address}, {profile.landmark}, {profile.locality}, {profile.city}, {profile.state} — {profile.pincode}</p><a href="/account" className="mt-2 inline-block text-[10px] font-bold uppercase tracking-wider text-clay underline">Edit in My Details</a></div>
          <form onSubmit={fetchRates} className="mt-4"><button disabled={busy} className="btn-secondary inline-flex w-full items-center justify-center gap-2">{busy ? 'Checking…' : 'Calculate delivery rates'} <MapPin size={15}/></button></form>
          {rates.length > 0 && <div className="mt-4"><h3 className="font-display text-2xl">Choose a delivery option for each Artist studio</h3><div className="mt-3 grid gap-4">{rates.map((group) => <section key={group.groupKey} className="rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><b className="font-display text-xl">{group.artistName}</b><p className="text-[10px] text-muted">{group.itemCount} artwork(s) from this Artist studio</p></div><span className="pill">Artist studio</span></div><div className="grid gap-2">{group.couriers.map((rate) => <label key={rate.courier_company_id} className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${chosen[group.groupKey]?.courier_company_id === rate.courier_company_id ? 'border-clay bg-[#f7eee6]' : 'border-[#D9C6A6]'}`}><span className="flex items-center gap-2"><input type="radio" name={`courier-${group.groupKey}`} checked={chosen[group.groupKey]?.courier_company_id === rate.courier_company_id} onChange={() => setChosen((current) => ({ ...current, [group.groupKey]: rate }))} /><span><b className="block text-sm">{rate.courier_name}</b><small className="block text-muted">{rate.description || rate.etd || 'Delivery estimate unavailable'}</small>{rate.delivery_mode === 'shiprocket' && <small className="text-[9px] text-muted">Live Shiprocket quote</small>}</span></span><b>{inr(rate.rate)}</b></label>)}</div></section>)}</div><button onClick={checkout} disabled={busy || rates.some((group) => !chosen[group.groupKey])} className="btn-primary mt-4 w-full">{busy ? 'Processing…' : `Pay ${inr(total)} with Razorpay`} <IndianRupee size={15}/></button><p className="mt-3 text-center text-[9px] leading-5 text-muted">All displayed options are live Shiprocket courier quotes for the Artist studio pickup PIN and your delivery PIN, sorted from lowest price first.</p></div>}
        </>}
      </>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && !success && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    </aside></div>}
  </main>;
}
