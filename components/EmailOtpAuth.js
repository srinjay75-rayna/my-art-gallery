"use client";
import { useState } from 'react';
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, UserRoundPlus } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/**
 * Supabase passwordless authentication for both Customers and Artists.
 * Existing Users receive a sign-in link. New Users submit only name, email,
 * and mobile number, then the verification link takes them to onboarding.
 */
export default function EmailOtpAuth({ accountType = 'customer', redirectBase = '/account', onSent }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isArtist = accountType === 'artist';
  const accountLabel = isArtist ? 'Artist' : 'Customer';
  const dashboardPath = isArtist ? '/artist' : '/account';
  const onboardingPath = isArtist ? '/artist/onboarding' : '/account/onboarding';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw new Error('Enter your email address.');
      if (mode === 'signup') {
        if (name.trim().length < 2) throw new Error(isArtist ? 'Enter your Artist or studio name.' : 'Enter your full name.');
        if (!/^\d{10}$/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
      }
      const supabase = getBrowserSupabase();
      const emailRedirectTo = `${window.location.origin}${mode === 'signup' ? onboardingPath : dashboardPath}`;
      const options = {
        shouldCreateUser: mode === 'signup',
        emailRedirectTo,
      };
      if (mode === 'signup') {
        options.data = {
          account_type: accountType,
          full_name: isArtist ? '' : name.trim(),
          artist_name: isArtist ? name.trim() : '',
          phone: `+91${phone}`,
          brand: 'Artiste',
        };
      }
      const { error: authError } = await supabase.auth.signInWithOtp({ email: normalizedEmail, options });
      if (authError) throw authError;
      const message = mode === 'signup'
        ? `A verification email has been sent to ${normalizedEmail}. Once verified, you will continue to your ${accountLabel} onboarding page.`
        : `A secure sign-in link has been sent to ${normalizedEmail}. Open it on this device to access your ${accountLabel} account.`;
      setNotice(message);
      onSent?.({ mode, email: normalizedEmail });
    } catch (err) {
      setError(err.message || 'We could not send the email. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[#e5dccf] bg-[#fffdf8] shadow-soft">
      <div className="grid grid-cols-2 border-b border-[#e9e0d5] p-2">
        <button type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); }} className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${mode === 'login' ? 'bg-ink text-white' : 'text-muted hover:bg-[#f5efe7]'}`}>
          <LockKeyhole size={15} strokeWidth={1.8} /> Existing User — Log In
        </button>
        <button type="button" onClick={() => { setMode('signup'); setError(''); setNotice(''); }} className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${mode === 'signup' ? 'bg-ink text-white' : 'text-muted hover:bg-[#f5efe7]'}`}>
          <UserRoundPlus size={15} strokeWidth={1.8} /> New User — Sign Up
        </button>
      </div>
      <div className="p-6 md:p-7">
        <p className="eyebrow flex items-center gap-2"><Mail size={13} /> Secure email sign-in</p>
        <h2 className="mt-2 font-display text-3xl">{mode === 'login' ? `Welcome back, ${accountLabel.toLowerCase()}.` : `Join Artiste as ${isArtist ? 'an Artist' : 'a Customer'}.`}</h2>
        <p className="mt-2 text-xs leading-6 text-muted">
          {mode === 'login'
            ? 'Enter only your email. We will send a secure, one-time sign-in link.'
            : 'Start with three details. Your email verification link opens a separate, secure onboarding page.'}
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4">
          {mode === 'signup' && <>
            <label className="label">{isArtist ? 'Artist / Studio Name' : 'Full Name'}<input className="field mt-1" required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isArtist ? 'Your Artist or studio name' : 'Your full name'} /></label>
            <label className="label">Mobile Number <span className="normal-case tracking-normal text-clay">+91</span><div className="mt-1 flex items-center rounded-xl border border-[#ded6ca] bg-[#fffefa] px-3"><span className="mr-2 text-sm text-muted">+91</span><input className="w-full bg-transparent py-3 text-sm outline-none" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[0-9]{10}" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" /></div></label>
          </>}
          <label className="label">Email Address<input className="field mt-1" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <button className="btn-primary flex w-full items-center justify-center gap-2" disabled={busy}>
            {busy ? 'Sending secure email…' : mode === 'signup' ? 'Send verification email' : 'Send sign-in link'} <ArrowRight size={15} />
          </button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mt-4 flex gap-2 rounded-xl bg-green-50 p-3 text-sm leading-6 text-green-900"><CheckCircle2 className="mt-1 shrink-0" size={16} />{notice}</p>}
        <p className="mt-4 text-[10px] leading-5 text-muted">Artiste uses passwordless email verification. Your private account pages are available only after the verification link has been completed.</p>
      </div>
    </section>
  );
}
