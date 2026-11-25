"use client";

import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, ClipboardList } from 'lucide-react';
import { portalFetch } from '@/lib/client-auth';
import siteConfig from '@/lib/siteConfig';

const agreementItems = [
  ['original_work', 'I confirm that every submitted artwork is 100% original work created by me and that I hold the rights to sell it.'],
  ['commission_and_payout', 'I agree to the applicable commission tier: 80% Artist / 20% Platform for the first 10 approved Founding Artists, and 75% Artist / 25% Platform for every subsequent approved artist. I understand payout is released 48 hours after courier delivery is marked Delivered.'],
  ['secure_packing', 'I agree to securely pack each sold artwork and make it ready for courier pickup within 48 hours of the order.'],
  ['promotion_permission', 'I permit Artiste to use approved artwork photos and promotional / behind-the-scenes clips to market my work.'],
];

const initial = { full_name: '', studio_name: '', whatsapp_number: '', instagram_handle: '', city: '', pincode: '', art_style_bio: '' };

export default function FoundingArtistApplication() {
  const [values, setValues] = useState(initial);
  const [photos, setPhotos] = useState([]);
  const [agreements, setAgreements] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const allAgreementsAccepted = agreementItems.every(([key]) => agreements[key] === true);
  function update(key, value) { setValues((current) => ({ ...current, [key]: value })); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (photos.length < 3 || photos.length > 5) throw new Error('Please choose 3–5 clear portfolio photographs.');
      if (agreementItems.some(([key]) => !agreements[key])) throw new Error('Please accept all four mandatory agreements.');
      const body = new FormData();
      Object.entries(values).forEach(([key, value]) => body.set(key, value));
      photos.forEach((photo) => body.append('photos', photo));
      agreementItems.forEach(([key]) => body.set(`agreement_${key}`, String(Boolean(agreements[key]))));
      const response = await portalFetch('/api/artist/applications', { method: 'POST', body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit the application.');
      setNotice(data.message || 'Application submitted.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="mt-8 rounded-3xl border border-[#D9C6A6] bg-[#FAF6F0] p-6 shadow-soft md:p-8">
    <p className="eyebrow flex items-center gap-2"><ClipboardList size={14}/> Founding Artist application</p>
    <h2 className="mt-2 font-display text-3xl">Apply to become a Founding Artist.</h2>
    <p className="mt-2 max-w-2xl text-xs leading-6 text-muted">Submit your profile, a short bio and 3–5 portfolio photos. The first 10 approved Founding Artists receive an 80% artist share; every subsequent approved artist receives a 75% share. Bank details can be added later.</p>
    <form onSubmit={submit} className="mt-6 grid gap-5">
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">1. Full Name &amp; Artist / Studio Name</legend>
        <label className="label">Full name<input className="field mt-1" required value={values.full_name} onChange={(e) => update('full_name', e.target.value)}/></label>
        <label className="label">Artist / Studio name<input className="field mt-1" required value={values.studio_name} onChange={(e) => update('studio_name', e.target.value)}/></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">2. WhatsApp Number &amp; Instagram Handle</legend>
        <label className="label">WhatsApp number<input className="field mt-1" required inputMode="numeric" maxLength={10} value={values.whatsapp_number} onChange={(e) => update('whatsapp_number', e.target.value.replace(/\D/g, '').slice(0,10))}/></label>
        <label className="label">Instagram handle (optional)<input className="field mt-1" placeholder="@yourstudio" value={values.instagram_handle} onChange={(e) => update('instagram_handle', e.target.value)}/></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 text-sm font-semibold">3. City &amp; PIN Code</legend>
        <label className="label">City<input className="field mt-1" required value={values.city} onChange={(e) => update('city', e.target.value)}/></label>
        <label className="label">6-digit PIN code<input className="field mt-1" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={values.pincode} onChange={(e) => update('pincode', e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
      </fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">4. Short Bio</legend><textarea className="field min-h-28" required maxLength={1200} value={values.art_style_bio} onChange={(e) => update('art_style_bio', e.target.value)} placeholder="Describe your practice, inspirations and creative approach."/></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">5. Upload 3–5 clear portfolio photos</legend><input className="block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required onChange={(e) => setPhotos(Array.from(e.target.files || []).slice(0,5))}/><p className="mt-1 text-[10px] text-muted">JPG, PNG, WEBP or AVIF; maximum 8 MB each. {photos.length} photo(s) selected.</p></fieldset>
      <fieldset><legend className="mb-3 text-sm font-semibold">6. Four mandatory agreements</legend><div className="grid gap-3">{agreementItems.map(([key,label]) => <label key={key} className="flex items-start gap-3 text-xs leading-5"><input className="mt-1" type="checkbox" checked={Boolean(agreements[key])} onChange={(e) => setAgreements((current) => ({...current,[key]:e.target.checked}))}/><span>{label}</span></label>)}</div></fieldset>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0"/>{notice}</p>}
      <button type="submit" disabled={busy || !allAgreementsAccepted} aria-disabled={busy || !allAgreementsAccepted} className="btn-primary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45">{busy ? 'Submitting application…' : 'Submit Founding Artist Application'}<ArrowUpRight size={15}/></button>
    </form>
  </section>;
}
