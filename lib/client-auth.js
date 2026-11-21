// Accept both OTP-issued sessions and the optional direct password-login method.
// All sessions still come from Supabase Auth and are validated server-side.
export function hasEmailOtpSession(session) {
  const token = session?.access_token;
  if (!token || typeof token !== 'string') return false;
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return false;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    const methods = Array.isArray(payload.amr)
      ? payload.amr.filter((entry) => entry?.method && entry.method !== 'token_refresh').sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).map((entry) => entry.method)
      : [];
    const latestNonRefresh = methods[0];
    return ['otp', 'email/signup', 'magiclink', 'email', 'password'].includes(latestNonRefresh);
  } catch {
    return false;
  }
}
