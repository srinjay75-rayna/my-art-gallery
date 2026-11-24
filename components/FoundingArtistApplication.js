"use client";

import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, ClipboardList } from 'lucide-react';
import { portalFetch } from '@/lib/client-auth';
import siteConfig from '@/lib/siteConfig';

const agreementItems = [
  ['original_work', 'I confirm that every submitted artwork is 100% original work created by me and that I hold the rights to sell it.'],
  ['commission_and_payout', 'I agree to the 70% Artist / 30% Platform split, or the 80% Artist / 20% Platform split if I am approved as a Founding Artist, and understand payout is released 48 hours after courier delivery is marked Delivered.'],
  ['secure_packing', 'I agree to securely pack each sold artwork and make it ready for courier pickup within 48 hours of the order.'],
  ['promotion_permission', 'I permit Artiste to use approved artwork photos and promotional / behind-the-scenes clips to market my work.'],
];

const initial = {
  full_name: '', studio_name: '', whatsapp_number: '', instagram_handle: '', city: '', pincode: '', art_style_bio: '',
  artwork_title: '', artwork_medium: '', artwork_dimensions: '', framed_status: 'Unframed', desired_artist_payout: '',
};

export default function FoundingArtistApplication() {
  const [values, setValues] = useState(initial);
  const [photos, setPhotos] = useState([]);
  const [agreements, setAgreements] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function update(key, value) { setValues((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (photos.length < 3 || photos.length > 5) throw new Error('Please choose 3–5 artwork photographs.');
      if (agreementItems.some(([key]) => !agreements[key])) throw new Error('Please accept all four mandatory agreements.');
      const body = new FormData();
      Object.entries(values).forEach(([key, value]) => body.set(key, value));
      photos.forEach((photo) => body.append('photos', photo));
      agreementItems.forEach(([key]) => body.set(`agreement_${key}`, String(Boolean(agreements[key]))));
      const response = await portalFetch('/api/artist/applications', { method: 'POST', body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit the application.');
      setNotice(data.message || 'Application submitted.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-3xl border border-[#D9C6A6] bg-[#FAF6F0] p-6 shadow-soft md:p-8">
    <p className="eyebrow flex items-center gap-2"><ClipboardList size={14}/> Founding Artist application · 8 questions</p>
    <h2 className="mt-2 font-display text-3xl">Tell us the story behind your work.</h2>
    <p className="mt-2 max-w-2xl text-xs leading-6 text-muted">Your application and portfolio are saved securely with your Creator profile. Bank details are optional and can be added later in Studio Profile.</p>
    {siteConfig.foundingArtistGoogleFormUrl && <p className="mt-2 text-xs"><a className="font-semibold text-clay underline" href={siteConfig.foundingArtistGoogleFormUrl} target="_blank" rel="noreferrer">Open the optional external Founding Artist form ↗</a></p>}
    <form onSubmit={submit} className="mt-6 grid gap-5">
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">1. Full Name &amp; Artist / Studio Name</legend>
        <label className="label">Full name<input className="field mt-1" required value={values.full_name} onChange={(e) => update('full_name', e.target.value)}/></label>
        <label className="label">Artist / Studio name<input className="field mt-1" required value={values.studio_name} onChange={(e) => update('studio_name', e.target.value)}/></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">2. WhatsApp Number &amp; Instagram Handle</legend>
        <label className="label">WhatsApp number<input className="field mt-1" required inputMode="numeric" maxLength={10} value={values.whatsapp_number} onChange={(e) => update('whatsapp_number', e.target.value.replace(/\D/g, '').slice(0, 10))}/></label>
        <label className="label">Instagram handle<input className="field mt-1" placeholder="@yourstudio" value={values.instagram_handle} onChange={(e) => update('instagram_handle', e.target.value)}/></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">3. City &amp; PIN Code</legend>
        <label className="label">City<input className="field mt-1" required value={values.city} onChange={(e) => update('city', e.target.value)}/></label>
        <label className="label">6-digit PIN code<input className="field mt-1" required inputMode="numeric" maxLength={6} value={values.pincode} onChange={(e) => update('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}/></label>
      </fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">4. Your Art Style Bio (3–4 sentences)</legend><textarea className="field min-h-28" required maxLength={1200} value={values.art_style_bio} onChange={(e) => update('art_style_bio', e.target.value)} placeholder="Describe your practice, inspirations, materials and the story you want collectors to feel."/></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">5. Upload 3–5 clear photos of available original artworks</legend><input className="block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required onChange={(e) => setPhotos(Array.from(e.target.files || []).slice(0, 5))}/><p className="mt-1 text-[10px] text-muted">JPG, PNG, WEBP or AVIF; up to 8 MB per image. These images form your portfolio submission.</p><p className="mt-1 text-xs text-muted">{photos.length} photo(s) selected</p></fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">6. Artwork Details</legend>
        <label className="label">Artwork title<input className="field mt-1" required value={values.artwork_title} onChange={(e) => update('artwork_title', e.target.value)}/></label>
        <label className="label">Medium<input className="field mt-1" required value={values.artwork_medium} onChange={(e) => update('artwork_medium', e.target.value)}/></label>
        <label className="label">Dimensions (inches)<input className="field mt-1" required value={values.artwork_dimensions} onChange={(e) => update('artwork_dimensions', e.target.value)} placeholder="e.g. 24 × 30 inches"/></label>
        <label className="label">Framed / Unframed<select className="field mt-1" value={values.framed_status} onChange={(e) => update('framed_status', e.target.value)}><option>Unframed</option><option>Framed</option></select></label>
      </fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">7. Desired Artist Payout per piece (₹)</legend><input className="field" type="number" required min="1" step="1" value={values.desired_artist_payout} onChange={(e) => update('desired_artist_payout', e.target.value)} placeholder="Amount you want to receive"/></fieldset>
      <fieldset><legend className="mb-3 text-sm font-semibold">8. Mandatory agreements</legend><div className="grid gap-3">{agreementItems.map(([key, label]) => <label key={key} className="flex items-start gap-3 text-xs leading-5"><input className="mt-1" type="checkbox" checked={Boolean(agreements[key])} onChange={(e) => setAgreements((current) => ({ ...current, [key]: e.target.checked }))}/><span>{label}</span></label>)}</div></fieldset>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0"/>{notice}</p>}
      <button disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2">{busy ? 'Submitting application…' : 'Submit Founding Artist Application'}<ArrowUpRight size={15}/></button>
    </form>
  </section>;
}
