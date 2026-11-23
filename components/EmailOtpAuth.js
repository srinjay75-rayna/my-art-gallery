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
import { setPortalSession } from '@/lib/client-auth';

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

      if (now >= cooldown.until) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [cooldown.until]);

  function startCooldown(forEmail, seconds) {
    const now = Date.now();
    setTick(now);

    setCooldown({
      email: forEmail,
      until: now + Math.max(1, seconds) * 1000,
    });
  }

  const secondsLeft = Math.max(
    0,
    Math.ceil((cooldown.until - tick) / 1000)
  );

  const cooling =
    secondsLeft > 0 &&
    email.trim().toLowerCase() === cooldown.email;

  const needsCodeStep =
    mode === 'signup' ||
    resetPasswordFlow ||
    loginMethod === 'otp';

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
        if (name.trim().length < 2) {
          throw new Error(
            isArtist
              ? 'Enter your Artist or studio name.'
              : 'Enter your full name.'
          );
        }

        if (!/^\d{10}$/.test(phone)) {
          throw new Error('Enter a valid 10-digit Indian mobile number.');
        }

        if (password.length < 8) {
          throw new Error('Create a password with at least 8 characters.');
        }
      }

      if (resetPasswordFlow && password.length < 8) {
        throw new Error('Your new password must contain at least 8 characters.');
      }

      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          accountType,
          purpose,
          name: name.trim(),
          phone: purpose === 'signup' ? `+91${phone}` : undefined,
          creatorRole: isArtist ? creatorRole : undefined,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 429) {
          const headerSeconds = Number(
            response.headers.get('Retry-After') || 0
          );

          const retryAfter = headerSeconds > 0
            ? headerSeconds
            : /30 seconds/i.test(String(result.error || ''))
              ? RESEND_SECONDS
              : 0;

          // Only short, per-email waits are shown as a resend countdown;
          // hourly limits are reported through the error message instead.
          if (
            retryAfter > 0 &&
            retryAfter <= MAX_SERVER_COOLDOWN_SECONDS
          ) {
            startCooldown(normalizedEmail, retryAfter);
          }
        }

        throw new Error(
          result.error || 'Could not send your verification code.'
        );
      }

      setEmail(normalizedEmail);
      setOtpSent(true);
      setOtp('');

      startCooldown(
        normalizedEmail,
        Number(result.resendAfterSeconds) || RESEND_SECONDS
      );

      setNotice(
        `A 6-digit verification code has been sent to ${normalizedEmail}. Enter it below without leaving this page.`
      );

      onSent?.({
        mode: purpose,
        email: normalizedEmail,
        creatorRole: isArtist ? creatorRole : undefined,
      });
    } catch (err) {
      setError(
        err.message ||
        'Could not send your verification code. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(purpose) {
    setBusy(true);
    setError('');

    try {
      if (!/^\d{6}$/.test(otp)) {
        throw new Error('Enter the 6-digit code from your email.');
      }

      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          accountType,
          purpose,
          otp,
          password: purpose === 'signup' || resetPasswordFlow
            ? password
            : undefined,
          creatorRole: isArtist ? creatorRole : undefined,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error || 'That code could not be verified.'
        );
      }

      if (!result.session?.access_token) {
        throw new Error(
          'Verification succeeded, but we could not start your session. Please try again.'
        );
      }

      setPortalSession(result.session, result.user);

      setNotice(
        result.message ||
        (
          purpose === 'signup'
            ? 'Email verified. Opening your secure onboarding form…'
            : 'You are signed in. Opening your account…'
        )
      );

      router.replace(
        purpose === 'signup'
          ? onboardingPath
          : dashboardPath
      );

      router.refresh();
    } catch (err) {
      setError(
        err.message ||
        'That code could not be verified. Please try again.'
      );
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

      if (!normalizedEmail || !password) {
        throw new Error('Enter your email address and password.');
      }

      const response = await fetch('/api/auth/login-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          accountType,
          creatorRole: isArtist ? creatorRole : undefined,
        }),
        cache: 'no-store',
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error ||
          'Incorrect portal password. Use Forgot password to reset it.'
        );
      }

      if (!result.session?.access_token) {
        throw new Error(
          'Your portal was verified, but a session could not be started. Please try again.'
        );
      }

      setPortalSession(result.session, result.user);

      setNotice(
        result.message ||
        'You are signed in to your selected Artiste portal.'
      );

      router.replace(dashboardPath);
      router.refresh();
    } catch (err) {
      setError(
        err.message ||
        'Could not sign in. Check your details and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();

    if (mode === 'signup') {
      return otpSent
        ? verifyOtp('signup')
        : sendOtp('signup');
    }

    if (resetPasswordFlow) {
      // The verified login-purpose OTP updates only the selected
      // Customer, Painter or Photographer password on the server.
      return otpSent
        ? verifyOtp('login')
        : sendOtp('login');
    }

    if (loginMethod === 'otp') {
      return otpSent
        ? verifyOtp('login')
        : sendOtp('login');
    }

    return loginWithPassword(event);
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] shadow-soft">
      <div className="grid grid-cols-2 border-b border-[#e9e0d5] p-2">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setLoginMethod('password');
            setResetPasswordFlow(false);
            setPassword('');
            resetCodeFlow();
          }}
          className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${
            mode === 'login'
              ? 'bg-ink text-white'
              : 'text-muted hover:bg-[#f5efe7]'
          }`}
        >
          <LockKeyhole size={15} strokeWidth={1.8} />
          Existing User — Log In
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setLoginMethod('password');
            setResetPasswordFlow(false);
            setPassword('');
            resetCodeFlow();
          }}
          className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.12em] transition ${
            mode === 'signup'
              ? 'bg-ink text-white'
              : 'text-muted hover:bg-[#f5efe7]'
          }`}
        >
          <UserRoundPlus size={15} />
          New User — Sign Up
        </button>
      </div>

      <div className="p-6 md:p-7">
        <p className="eyebrow flex items-center gap-2">
          <ShieldCheck size={13} />
          Secure in-page email verification
        </p>

        <h2 className="mt-2 font-display text-3xl">
          {mode === 'login'
            ? `Welcome back, ${accountLabel.toLowerCase()}.`
            : `Join Artiste as ${isArtist ? 'an Artist' : 'a Customer'}.`}
        </h2>

        <p className="mt-2 text-xs leading-6 text-muted">
          {resetPasswordFlow
            ? 'Choose a new password, receive a 6-digit email code and verify it here. This resets only the selected Customer, Painter or Photographer portal password.'
            : mode === 'login'
              ? 'Sign in with the password for this selected portal, or receive a 6-digit email code. Each portal has its own independent password.'
              : 'Enter your details and create a password. We will email a 6-digit code that you verify right here.'}
        </p>

        {mode === 'login' && !resetPasswordFlow && (
          <div className="mt-5 flex rounded-xl border border-[#e6ddd1] bg-[#f8f3ec] p-1">
            <button
              type="button"
              onClick={() => {
                setResetPasswordFlow(false);
                setLoginMethod('password');
                resetCodeFlow();
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                loginMethod === 'password'
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted'
              }`}
            >
              Email + Password
            </button>

            <button
              type="button"
              onClick={() => {
                setResetPasswordFlow(false);
                setLoginMethod('otp');
                setPassword('');
                resetCodeFlow();
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                loginMethod === 'otp'
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted'
              }`}
            >
              Email + 6-Digit OTP
            </button>
          </div>
        )}

        <form onSubmit={submit} className="mt-5 grid gap-4">
          {mode === 'signup' && (
            <>
              <label className="label">
                {isArtist ? 'Artist / Studio Name' : 'Full Name'}

                <input
                  className="field mt-1"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  disabled={otpSent || busy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isArtist
                      ? 'Your Artist or studio name'
                      : 'Your full name'
                  }
                />
              </label>

              <label className="label">
                Mobile Number
                <span className="normal-case tracking-normal text-clay">
                  {' '}+91
                </span>

                <div className="mt-1 flex items-center rounded-xl border border-[#D9C6A6] bg-[#FAF6F0] px-3">
                  <span className="mr-2 text-sm text-muted">+91</span>

                  <input
                    className="w-full bg-transparent py-3 text-sm outline-none disabled:opacity-60"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    required
                    pattern="[0-9]{10}"
                    maxLength={10}
                    disabled={otpSent || busy}
                    value={phone}
                    onChange={(e) => setPhone(
                      e.target.value.replace(/\D/g, '').slice(0, 10)
                    )}
                    placeholder="10-digit mobile number"
                  />
                </div>
              </label>
            </>
          )}

          <label className="label">
            Email Address

            <input
              className="field mt-1"
              type="email"
              autoComplete="email"
              required
              disabled={otpSent || busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          {isArtist && (
            <label className="label">
              Creator Discipline

              <select
                className="field mt-1"
                value={creatorRole}
                disabled={otpSent || busy}
                onChange={(e) => setCreatorRole(e.target.value)}
              >
                <option value="Painter">Painter</option>
                <option value="Photographer">Photographer</option>
              </select>
            </label>
          )}

          {(mode === 'signup' || resetPasswordFlow || loginMethod === 'password') && (
            <label className="label">
              {resetPasswordFlow
                ? 'New Password'
                : mode === 'signup'
                  ? 'Create Password'
                  : 'Portal Password'}

              <input
                className="field mt-1"
                type="password"
                autoComplete={
                  mode === 'signup'
                    ? 'new-password'
                    : 'current-password'
                }
                minLength={8}
                maxLength={72}
                required
                disabled={busy || (otpSent && !resetPasswordFlow && mode === 'signup')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
          )}

          {needsCodeStep && (
            <label className="label">
              6-Digit Email Verification Code

              <input
                className="field mt-1 text-center text-xl tracking-[.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="[0-9]{6}"
                maxLength={6}
                disabled={!otpSent || busy}
                value={otp}
                onChange={(e) => setOtp(
                  e.target.value.replace(/\D/g, '').slice(0, 6)
                )}
                placeholder="000000"
              />
            </label>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"
            >
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs leading-5 text-green-800"
            >
              {notice}
            </p>
          )}

          {mode === 'login' && !resetPasswordFlow && loginMethod === 'password' && (
            <button
              type="button"
              className="justify-self-start text-xs font-semibold text-clay underline underline-offset-4"
              onClick={() => {
                setResetPasswordFlow(true);
                setPassword('');
                resetCodeFlow();
              }}
            >
              Forgot password?
            </button>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              disabled={
                busy ||
                (cooling && (!otpSent || !otp)) ||
                (needsCodeStep && otpSent && !/^\d{6}$/.test(otp))
              }
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              {busy
                ? 'Please wait…'
                : mode === 'signup' && !otpSent
                  ? 'Send verification code'
                  : needsCodeStep && !otpSent
                    ? 'Send verification code'
                    : needsCodeStep
                      ? 'Verify & Continue'
                      : 'Log In'}

              {!busy && <ArrowRight size={15} />}
            </button>

            {needsCodeStep && otpSent && (
              <button
                type="button"
                disabled={busy || cooling}
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => sendOtp(mode === 'signup' ? 'signup' : 'login')}
              >
                <RefreshCw size={14} />
                {cooling ? `Resend in ${secondsLeft}s` : 'Resend code'}
              </button>
            )}

            {otpSent && (
              <button
                type="button"
                disabled={busy}
                className="btn-secondary"
                onClick={() => resetCodeFlow()}
              >
                Change email
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
