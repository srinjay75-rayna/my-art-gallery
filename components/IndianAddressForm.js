"use client";
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, MapPin, PencilLine } from 'lucide-react';
import { INDIAN_STATES_UTS, normaliseIndianPhone } from '@/lib/india-address';

const states = INDIAN_STATES_UTS;
export default function IndianAddressForm({ value, onChange, showContact = true, addressLabel = 'Full street address', compact = false }) {
  const [areas, setAreas] = useState([]);
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState('');
  const pincode = String(value?.pincode || '');

  useEffect(() => {
    if (!/^\d{6}$/.test(pincode)) { setAreas([]); setLookup(''); setLookupError(''); return; }
    let cancelled = false;
    const controller = new AbortController();
    setLookup('looking'); setLookupError('');
    const timer = setTimeout(async () => {
      try {
        // India Post public PIN directory (no key required).
        const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('PIN directory is temporarily unavailable.');
        const data = await response.json();
        const record = Array.isArray(data) ? data[0] : null;
        if (!record || record.Status !== 'Success' || !Array.isArray(record.PostOffice) || !record.PostOffice.length) throw new Error('No post office details were found for this PIN code.');
        const postOffices = record.PostOffice;
        const names = [...new Set(postOffices.map((office) => String(office.Name || '').trim()).filter(Boolean))];
        const first = postOffices[0];
        if (cancelled) return;
        const rawState = String(first.State || '').trim();
        const stateAliases = {
          'orissa': 'Odisha',
          'pondicherry': 'Puducherry',
          'nct of delhi': 'Delhi',
          'national capital territory of delhi': 'Delhi',
          'jammu & kashmir': 'Jammu and Kashmir',
          'andaman & nicobar islands': 'Andaman and Nicobar Islands',
          'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
          'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
        };
        const canonicalState = stateAliases[rawState.toLowerCase()] || states.find((item) => item.toLowerCase() === rawState.toLowerCase()) || '';
        setAreas(names);
        onChange({
          locality: value.locality && names.includes(value.locality) ? value.locality : (names[0] || ''),
          city: first.District || first.Block || value.city || '',
          state: canonicalState || value.state || '',
        });
        setLookup('success');
      } catch (err) {
        if (err.name === 'AbortError' || cancelled) return;
        setAreas([]); setLookup('manual'); setLookupError('PIN lookup is unavailable. You can enter the area, city and state manually.');
      }
    }, 350);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    // Run lookup only when the six digit PIN changes; locality selection must not trigger another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode]);

  const update = (key, next) => onChange({ [key]: next });
  const phone = normaliseIndianPhone(value?.phone || '');
  const cityLabel = useMemo(() => 'City / District', []);

  return <div className="grid gap-4 sm:grid-cols-2">
    {showContact && <>
      <label className="label sm:col-span-2">Full name<input className="field mt-1" autoComplete="name" required value={value.full_name || ''} onChange={(e) => update('full_name', e.target.value)} maxLength={100} /></label>
      <label className="label sm:col-span-2">Mobile number <span className="normal-case tracking-normal text-clay">+91</span><div className="mt-1 flex items-center rounded-xl border border-[#ded6ca] bg-[#fffefa] px-3"><span className="mr-2 text-sm text-muted">+91</span><input className="w-full bg-transparent py-3 text-sm outline-none" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[0-9]{10}" maxLength={10} value={phone} onChange={(e) => update('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" /></div></label>
    </>}
    <label className="label sm:col-span-2">{addressLabel}<textarea className="field mt-1 min-h-24" autoComplete="street-address" required value={value.address || ''} onChange={(e) => update('address', e.target.value)} maxLength={300} placeholder="House / flat number, street, building, locality" /></label>
    <label className="label sm:col-span-2">Landmark<input className="field mt-1" value={value.landmark || ''} onChange={(e) => update('landmark', e.target.value)} required maxLength={160} placeholder="Near post office, metro station, school…" /></label>
    <label className="label">6-digit PIN code<input className="field mt-1" inputMode="numeric" autoComplete="postal-code" required pattern="[0-9]{6}" maxLength={6} value={pincode} onChange={(e) => update('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="700047" /></label>
    <div className="label flex items-end pb-3 normal-case tracking-normal">
      {lookup === 'looking' && <span className="inline-flex items-center gap-1 text-muted"><LoaderCircle size={13} className="animate-spin"/> Looking up PIN code…</span>}
      {lookup === 'success' && <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={13}/> PIN details found</span>}
      {lookup === 'manual' && <span className="inline-flex items-center gap-1 text-amber-700"><PencilLine size={13}/> Manual entry available</span>}
      {!lookup && <span className="inline-flex items-center gap-1 text-muted"><MapPin size={13}/> Area suggestions appear after 6 digits</span>}
    </div>
    {areas.length > 0 ? <label className="label">Locality / Area<select className="field mt-1" required value={value.locality || ''} onChange={(e) => update('locality', e.target.value)}><option value="">Choose locality / area</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select></label> : <label className="label">Locality / Area<input className="field mt-1" required value={value.locality || ''} onChange={(e) => update('locality', e.target.value)} placeholder="Area / neighbourhood" /></label>}
    <label className="label">{cityLabel}<input className="field mt-1" required value={value.city || ''} onChange={(e) => update('city', e.target.value)} placeholder="City or district" /></label>
    <label className="label sm:col-span-2">State / Union Territory<select className="field mt-1" required value={value.state || ''} onChange={(e) => update('state', e.target.value)}><option value="">Select State / UT</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
    {lookupError && <p className="sm:col-span-2 -mt-2 text-[11px] leading-5 text-amber-800">{lookupError}</p>}
  </div>;
}
