"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import { normaliseIndianPhone } from '@/lib/india-address';
import IndianAddressForm from '@/components/IndianAddressForm';

const empty = { full_name: '', phone: '', address: '', landmark: '', locality: '', city: '', state: '', pincode: '' };
const isComplete = (p) => Boolean(
  p.full_name?.trim()
  && /^\d{10}$/.test(normaliseIndianPhone(p.phone))
  && p.address?.trim()
  && p.landmark?.trim()
  && p.locality?.trim()
  && p.city?.trim()
  && p.state?.trim()
  && /^\d{6}$/.test(String(p.pincode || ''))
);

function readStoredPhone() {
  if (typeof window === 'undefined') return '';
  const keys = ['artiste_customer_phone', 'artiste_customer_signup', 'artiste_signup_customer', 'artiste_signup_data', 'artiste_phone', 'customer_phone', 'phone'];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let candidate = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') candidate = parsed.phone || parsed.mobile || parsed.mobile_number || parsed.user?.phone || '';
      } catch {}
      const digits = normaliseIndianPhone(candidate);
      if (digits) return digits;
    } catch {}
  }
  return '';
}

function storePhone(value) {
  try { window.localStorage.setItem('artiste_customer_phone', normaliseIndianPhone(value)); } catch {}
}

export default function CustomerOnboardingPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function initialise() {
      try {
        const client = getBrowserSupabase();
        const { data } = await client.auth.getSession();
        const current = data.session;
        if (!current || !hasEmailOtpSession(current) || !current.user?.email_confirmed_at) {
          router.replace('/account');
          return;
        }
        const metadata = current.user.user_metadata || {};
        if (metadata.account_type && metadata.account_type !== 'customer') {
          await client.auth.signOut();
          router.replace('/account');
          return;
        }
        if (!active) return;
        setSession(current);
        const response = await fetch('/api/account', {
          headers: { Authorization: `Bearer ${current.access_token}` },
          cache: 'no-store',
        });
        const dataResult = await response.json();
        if (!response.ok) throw new Error(dataResult.error || 'Could not load your Customer profile.');

        // The Step 2 phone field is authoritative and editable. Prefer the saved
        // profile, then Supabase signup metadata, then a locally retained Step 1 value.
        const savedPhone = dataResult.profile?.phone || metadata.phone || readStoredPhone();
        const next = {
          ...empty,
          ...(dataResult.profile || {}),
          full_name: dataResult.profile?.full_name || metadata.full_name || '',
          phone: normaliseIndianPhone(savedPhone),
        };
        if (isComplete(next)) {
          router.replace('/account');
          return;
        }
        setProfile(next);
        if (next.phone) storePhone(next.phone);
      } catch (err) {
        if (active) setError(err.message || 'Could not load onboarding.');
      } finally {
        if (active) setLoading(false);
      }
    }
    initialise();
    return () => { active = false; };
  }, [router]);

  function updatePhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(-10);
    setProfile((current) => ({ ...current, phone: digits }));
    storePhone(digits);
  }

  async function save(event) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const phone = normaliseIndianPhone(profile.phone);
      if (!/^\d{10}$/.test(phone)) throw new Error('Enter or confirm your 10-digit Indian mobile number to continue.');

      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...profile, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your delivery details.');
      storePhone(phone);
      router.replace('/account');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-2xl rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-10 text-center"><ShieldCheck size={28} className="mx-auto text-clay" /><h1 className="mt-3 font-display text-2xl">Verifying your email session…</h1></div></main>;

  return <main className="paper-grain min-h-screen px-5 py-8 md:px-10"><div className="mx-auto max-w-3xl">
    <header className="mb-10 flex items-center justify-between"><a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span className="font-display text-2xl">Artiste</span></a><a href="/account" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"><ArrowLeft size={14} /> Account</a></header>
    <p className="eyebrow flex items-center gap-2"><CheckCircle2 size={14} /> Email verified · Step 2 of 2</p>
    <h1 className="mt-3 font-display text-5xl">Where should your <em className="font-normal text-clay">art arrive?</em></h1>
    <p className="mt-3 max-w-xl text-sm leading-7 text-muted">Complete your delivery address once. Artiste will securely save it to your Customer profile for future orders.</p>
    <div className="mt-6 rounded-2xl border border-[#e5dccf] bg-[#f7f1e8] p-4 text-sm"><p className="font-semibold">{profile.full_name || 'Customer'} · {session?.user?.email}</p><p className="mt-1 text-xs text-muted">+91 {normaliseIndianPhone(profile.phone)} · Confirm or update your mobile number below.</p></div>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <form onSubmit={save} className="mt-6 grid gap-5 rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft">
      {!profile.full_name && <label className="label">Full Name<input className="field mt-1" required value={profile.full_name} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} /></label>}
      <label className="label">+91 Mobile Number<div className="mt-1 flex items-center rounded-xl border border-[#ded6ca] bg-[#fffefa] px-3"><span className="mr-2 text-sm text-muted">+91</span><input className="w-full bg-transparent py-3 text-sm outline-none" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[0-9]{10}" maxLength={10} value={normaliseIndianPhone(profile.phone)} onChange={(e) => updatePhone(e.target.value)} placeholder="10-digit mobile number" /></div><span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">Enter or confirm the mobile number you want associated with your orders.</span></label>
      <h2 className="flex items-center gap-2 font-display text-2xl"><MapPin size={19} className="text-clay" /> Shipping Address</h2>
      <IndianAddressForm value={profile} onChange={(patch) => setProfile((current) => ({ ...current, ...patch }))} showContact={false} addressLabel="Full street address" />
      <button disabled={busy} className="btn-primary flex items-center justify-center gap-2">{busy ? 'Saving your address…' : 'Save address & continue'} <ArrowUpRight size={15} /></button>
      <p className="text-center text-[10px] leading-5 text-muted">Your phone, landmark, address and order history are private to your verified Customer account.</p>
    </form>
  </div></main>;
}
