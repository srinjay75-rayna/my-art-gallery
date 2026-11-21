"use client";
import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export default function EmailOtpAuth({ accountType = 'customer', onVerified }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function sendCode(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const supabase = getBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          data: { account_type: accountType, brand: 'Artiste' },
        },
      });
      if (authError) throw authError;
      setSent(true);
      setNotice('A 6-digit verification code has been sent to your email.');
    } catch (err) { setError(err.message || 'Could not send the verification code.'); }
    finally { setBusy(false); }
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(token)) { setError('Enter the 6-digit code from your email.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const supabase = getBrowserSupabase();
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(), token, type: 'email',
      });
      if (authError) throw authError;
      if (!data.session) throw new Error('Email verification did not create a session. Please request a new code.');
      setNotice('Email verified. Welcome to Artiste.');
      onVerified?.(data.session);
    } catch (err) { setError(err.message || 'The verification code could not be verified.'); }
    finally { setBusy(false); }
  }

  return <section className="rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft">
    <p className="eyebrow">Secure email verification</p>
    <h2 className="mt-2 font-display text-3xl">{sent ? 'Enter your code' : `Continue as ${accountType === 'artist' ? 'an Artist' : 'a Customer'}`}</h2>
    {!sent ? <form onSubmit={sendCode} className="mt-5 grid gap-4">
      <label className="label">Email address<input className="field mt-1" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send 6-digit email code'} ↗</button>
    </form> : <form onSubmit={verifyCode} className="mt-5 grid gap-4">
      <p className="text-sm leading-6 text-muted">We sent a code to <b className="text-ink">{email}</b>. Enter it below to verify your email and sign in.</p>
      <label className="label">6-digit verification code<input className="field mt-1 text-center text-xl tracking-[.35em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>
      <button className="btn-primary" disabled={busy || token.length !== 6}>{busy ? 'Verifying…' : 'Verify email & continue'} ↗</button>
      <button type="button" disabled={busy} onClick={() => { setSent(false); setToken(''); setNotice(''); setError(''); }} className="text-xs font-semibold text-clay">Use another email / resend code</button>
    </form>}
    {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <p className="mt-4 text-[11px] leading-5 text-muted">No password is required. Your email must be verified before your Artiste account can be accessed.</p>
  </section>;
}
