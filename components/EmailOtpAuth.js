"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserRoundPlus,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

const RESEND_SECONDS = 30;
const MAX_SERVER_COOLDOWN_SECONDS = 120;

/**
 * In-page authentication for Customers and Artists.
 * Email codes are issued by Artiste's own SMTP-backed OTP endpoints. No
 * Supabase email links, redirect URLs, or cross-device callbacks are used.
 */
export default function EmailOtpAuth({ accountType = 'customer', onSent }) {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [loginMethod, setLoginMethod] = useState('password');
  const [resetPasswordFlow, setResetPasswordFlow] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creatorRole, setCreatorRole] = useState('Painter');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  // The countdown is a wall-clock deadline (not a decrementing counter), so it
  // stays accurate when the browser throttles timers in a background tab.
  const [cooldown, setCooldown] = useState({ email: '', until: 0 });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isArtist = accountType === 'artist';
  const accountLabel = isArtist ? 'Artist' : 'Customer';
  const dashboardPath = isArtist ? '/artist' : '/account';
  const onboardingPath = isArtist ? '/artist/onboarding' : '/account/onboarding';

  function resetCodeFlow() {
    setOtpSent(false);
    setOtp('');
    setNotice('');
    setError('');
  }

  // Live resend countdown shared by the Customer and Artist portals. It matches
  // the server-side 30-second per-email limit, so the Resend button unlocks
  // exactly when a new code may be requested.
  useEffect(() => {
    if (cooldown.until <= Date.now()) return undefined;
    setTick(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTick(now);
      if (now >= cooldown.until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldown.until]);

  function startCooldown(forEmail, seconds) {
    const now = Date.now();
    setTick(now);
    setCooldown({ email: forEmail, until: now + Math.max(1, seconds) * 1000 });
  }

  const secondsLeft = Math.max(0, Math.ceil((cooldown.until - tick) / 1000));
  const cooling = secondsLeft > 0 && email.trim().toLowerCase() === cooldown.email;
  const needsCodeStep = mode === 'signup' || resetPasswordFlow || loginMethod === 'otp';

  async function sendOtp(purpose) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Enter a valid email address.');
      }
      if (purpose === 'signup') {
        if (name.trim().length < 2) throw new Error(isArtist ? 'Enter your Artist or studio name.' : 'Enter your full name.');
        if (!/^\d{10}$/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
        if (password.length < 8) throw new Error('Create a password with at least 8 characters.');
      }
      if (resetPasswordFlow && password.length < 8) {
        throw new Error('Your new password must contain at least 8 characters.');
      }

      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          accountType,
          purpose,
          name: name.trim(),
          phone: purpose === 'signup' ? `+91${phone}` : undefined,
          creatorRole: purpose === 'signup' && isArtist ? creatorRole : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          const headerSeconds = Number(response.headers.get('Retry-After') || 0);
          const retryAfter = headerSeconds > 0
            ? headerSeconds
            : /30 seconds/i.test(String(result.error || '')) ? RESEND_SECONDS : 0;
          // Only short, per-email waits are shown as a resend countdown;
          // hourly limits are reported through the error message instead.
          if (retryAfter > 0 && retryAfter <= MAX_SERVER_COOLDOWN_SECONDS) {
            startCooldown(normalizedEmail, retryAfter);
          }
        }
        throw new Error(result.error || 'Could not send your verification code.');
      }

      setEmail(normalizedEmail);
      setOtpSent(true);
      setOtp('');
      startCooldown(normalizedEmail, Number(result.resendAfterSeconds) || RESEND_SECONDS);
      setNotice(`A 6-digit verification code has been sent to ${normalizedEmail}. Enter it below without leaving this page.`);
      onSent?.({ mode: purpose, email: normalizedEmail, creatorRole: isArtist ? creatorRole : undefined });
    } catch (err) {
      setError(err.message || 'Could not send your verification code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(purpose) {
    setBusy(true);
    setError('');
    try {
      if (!/^\d{6}$/.test(otp)) throw new Error('Enter the 6-digit code from your email.');
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          accountType,
          purpose,
          otp,
          password: purpose === 'signup' || resetPasswordFlow ? password : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'That code could not be verified.');
      if (!result.session?.access_token || !result.session?.refresh_token) {
        throw new Error('Verification succeeded, but we could not start your session. Please try again.');
      }

      const supabase = getBrowserSupabase();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (sessionError) throw sessionError;

      setNotice(result.message || (purpose === 'signup' ? 'Email verified. Opening your secure onboarding form…' : 'You are signed in. Opening your account…'));
      router.replace(purpose === 'signup' ? onboardingPath : dashboardPath);
      router.refresh();
    } catch (err) {
      setError(err.message || 'That code could not be verified. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function loginWithPassword(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !password) throw new Error('Enter your email address and password.');
      const supabase = getBrowserSupabase();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (authError) {
        if (/invalid login credentials/i.test(authError.message || '')) {
          throw new Error('Incorrect email or password. If you are unsure of your password, choose “Forgot password?” to set a new one with an email code.');
        }
        throw authError;
      }

      // One verified Auth identity may have both Artiste portal profiles.
      // This server-side check selects only the portal whose profile exists and
      // updates the Auth metadata used by the protected API routes.
      const portalResponse = await fetch('/api/auth/select-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token || ''}`,
        },
        body: JSON.stringify({ accountType }),
        cache: 'no-store',
      });
      const portalResult = await portalResponse.json().catch(() => ({}));
      if (!portalResponse.ok) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error(portalResult.error || `This email is not registered in the ${accountLabel} portal.`);
      }

      // Refresh JWT/user metadata after the server selects the active portal.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await supabase.auth.signOut({ scope: 'local' });
        throw refreshError;
      }

      router.replace(dashboardPath);
      router.refresh();
    } catch (err) {
      setError(err.message || 'Could not sign in. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (mode === 'signup') {
      return otpSent ? verifyOtp('signup') : sendOtp('signup');
    }
    if (resetPasswordFlow) {
      // Reuse the existing login-purpose OTP row to remain compatible with
      // the deployed email_otps CHECK constraint. The verified password is
      // updated server-side after this code is consumed.
      return otpSent ? verifyOtp('login') : sendOtp('login');
    }
    if (loginMethod === 'otp') {
      return otpSent ? verifyOtp('login') : sendOtp('login');
    }
    return loginWithPassword(event);
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] shadow-soft">
      <div className="grid grid-cols-2 border-b border-[#e9e0d5] p-2">
        <button
          type="button"
          onClick={() => { setMode('login'); setLoginMethod('password'); setResetPasswordFlow(false); setPassword(''); resetCodeFlow(); }}
          className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${mode === 'login' ? 'bg-ink text-white' : 'text-muted hover:bg-[#f5efe7]'}`}
        >
          <LockKeyhole size={15} strokeWidth={1.8} /> Existing User — Log In
        </button>
        <button
          type="button"
          onClick={() => { setMode('signup'); setLoginMethod('password'); setResetPasswordFlow(false); setPassword(''); resetCodeFlow(); }}
          className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${mode === 'signup' ? 'bg-ink text-white' : 'text-muted hover:bg-[#f5efe7]'}`}
        >
          <UserRoundPlus size={15} strokeWidth={1.8} /> New User — Sign Up
        </button>
      </div>

      <div className="p-6 md:p-7">
        <p className="eyebrow flex items-center gap-2"><ShieldCheck size={13} /> Secure in-page email verification</p>
        <h2 className="mt-2 font-display text-3xl">
          {mode === 'login' ? `Welcome back, ${accountLabel.toLowerCase()}.` : `Join Artiste as ${isArtist ? 'an Artist' : 'a Customer'}.`}
        </h2>
        <p className="mt-2 text-xs leading-6 text-muted">
          {resetPasswordFlow
            ? 'Choose a new password, receive a 6-digit email code and verify it here to reset your password. This email has one shared password for both Customer and Artist portals.'
            : mode === 'login'
              ? 'Choose password sign-in or receive a 6-digit email code. You will stay on this browser tab.'
              : 'Enter your details and create a password. We will email a 6-digit code that you verify right here.'}
        </p>

        {mode === 'login' && !resetPasswordFlow && (
          <div className="mt-5 flex rounded-xl border border-[#e6ddd1] bg-[#f8f3ec] p-1">
            <button type="button" onClick={() => { setResetPasswordFlow(false); setLoginMethod('password'); resetCodeFlow(); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${loginMethod === 'password' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>
              Email + Password
            </button>
            <button type="button" onClick={() => { setResetPasswordFlow(false); setLoginMethod('otp'); setPassword(''); resetCodeFlow(); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${loginMethod === 'otp' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>
              Email + 6-Digit OTP
            </button>
          </div>
        )}

        <form onSubmit={submit} className="mt-5 grid gap-4">
          {mode === 'signup' && (
            <>
              <label className="label">
                {isArtist ? 'Artist / Studio Name' : 'Full Name'}
                <input className="field mt-1" required minLength={2} maxLength={100} autoComplete="name" disabled={otpSent || busy} value={name} onChange={(e) => setName(e.target.value)} placeholder={isArtist ? 'Your Artist or studio name' : 'Your full name'} />
              </label>
              {isArtist && (
                <label className="label">
                  Choose Your Discipline
                  <select className="field mt-1" value={creatorRole} onChange={(e) => setCreatorRole(e.target.value)} disabled={otpSent || busy}>
                    <option value="Painter">Painter — 2% Platform Fee · You Keep 98%</option>
                    <option value="Photographer">Photographer — 5% Platform Fee · You Keep 95%</option>
                  </select>
                  <span className="mt-2 block text-[10px] font-normal normal-case tracking-normal text-muted">
                    This choice sets up your Artist Studio and default listing category. You can update your discipline later in My Profile.
                  </span>
                </label>
              )}
              <label className="label">
                Mobile Number <span className="normal-case tracking-normal text-clay">+91</span>
                <div className="mt-1 flex items-center rounded-xl border border-[#D9C6A6] bg-[#FAF6F0] px-3">
                  <span className="mr-2 text-sm text-muted">+91</span>
                  <input className="w-full bg-transparent py-3 text-sm outline-none disabled:opacity-60" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[0-9]{10}" maxLength={10} disabled={otpSent || busy} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" />
                </div>
              </label>
            </>
          )}

          <label className="label">
            Email Address
            <input className="field mt-1" type="email" autoComplete="email" required disabled={otpSent || busy} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>

          {(mode === 'signup' || (mode === 'login' && loginMethod === 'password') || resetPasswordFlow) && (
            <label className="label">
              {mode === 'signup' ? 'Create Password' : resetPasswordFlow ? 'New Password' : 'Password'}
              <input className="field mt-1" type="password" autoComplete={mode === 'signup' || resetPasswordFlow ? 'new-password' : 'current-password'} minLength={mode === 'signup' || resetPasswordFlow ? 8 : undefined} required disabled={otpSent || busy} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' || resetPasswordFlow ? 'At least 8 characters' : 'Your password'} />
            </label>
          )}

          {mode === 'signup' && (
            <p className="-mt-2 text-[10px] leading-5 text-muted">
              One email address uses one Artiste sign-in password. If you add the other portal with this same email, the password you set here will be shared by both Customer and Artist access.
            </p>
          )}

          {mode === 'login' && loginMethod === 'password' && !resetPasswordFlow && !otpSent && (
            <div className="-mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => { setResetPasswordFlow(true); setLoginMethod('otp'); setPassword(''); resetCodeFlow(); }}
                className="text-[11px] font-semibold text-clay hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}

          {resetPasswordFlow && !otpSent && (
            <div className="-mt-2 flex justify-end">
              <button type="button" onClick={() => { setResetPasswordFlow(false); setLoginMethod('password'); setPassword(''); resetCodeFlow(); }} className="text-[11px] font-semibold text-clay hover:underline">
                Back to sign in
              </button>
            </div>
          )}

          {otpSent && (
            <div className="rounded-2xl border border-[#e6ddd1] bg-[#f8f3ec] p-4">
              <label className="label block">
                <span className="flex items-center gap-2"><KeyRound size={14} className="text-clay" /> 6-Digit Email Code</span>
                <input
                  className="field mt-2 text-center text-xl font-semibold tracking-[.45em]"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  aria-label="6-digit email verification code"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span>Sent to {email}</span>
                <button type="button" disabled={busy} onClick={() => { resetCodeFlow(); }} className="inline-flex items-center gap-1 font-semibold text-clay hover:underline">
                  <RefreshCw size={12} /> Change details
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e6ddd1] pt-3">
                <span className="text-[11px] text-muted">Didn’t receive the code?</span>
                <button
                  type="button"
                  disabled={busy || cooling}
                  onClick={() => sendOtp(mode === 'signup' ? 'signup' : 'login')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#D9C6A6] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-clay transition hover:bg-[#FAF6F0] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
                  {cooling ? `Resend OTP in ${secondsLeft}s` : 'Resend OTP'}
                </button>
              </div>
            </div>
          )}

          <button
            className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || (needsCodeStep && !otpSent && cooling)}
          >
            {busy
              ? 'Please wait…'
              : needsCodeStep && !otpSent
                ? (cooling ? `Send 6-Digit OTP · wait ${secondsLeft}s` : 'Send 6-Digit OTP')
                : resetPasswordFlow
                  ? 'Verify & Reset Password'
                  : mode === 'signup'
                    ? 'Verify & Continue'
                    : loginMethod === 'password'
                      ? 'Log In'
                      : 'Verify & Log In'}
            <ArrowRight size={15} />
          </button>
        </form>

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mt-4 flex gap-2 rounded-xl bg-green-50 p-3 text-sm leading-6 text-green-900"><CheckCircle2 className="mt-1 shrink-0" size={16} />{notice}</p>}
        <p className="mt-4 flex items-start gap-2 text-[10px] leading-5 text-muted">
          <Smartphone size={13} className="mt-0.5 shrink-0" /> No magic links or email redirects. Your 6-digit code is entered on this screen, and successful verification keeps you in this tab.
        </p>
        {mode === 'login' && loginMethod === 'otp' && <p className="mt-2 flex items-center gap-2 text-[10px] text-muted"><Mail size={12} /> Codes expire after 10 minutes and can only be used once.</p>}
      </div>
    </section>
  );
}
