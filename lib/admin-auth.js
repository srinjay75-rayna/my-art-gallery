import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'artiste_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
function configuredPassword() { return process.env.ADMIN_PASSWORD || ''; }
function sign(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
export function passwordMatches(candidate) {
  const expected = configuredPassword();
  if (!expected || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function createAdminToken() {
  const secret = configuredPassword();
  if (!secret) throw new Error('Set ADMIN_PASSWORD on the server before using the admin page.');
  const issuedAt = Math.floor(Date.now() / 1000).toString();
  return `${issuedAt}.${sign(`artiste:${issuedAt}`, secret)}`;
}
export function verifyAdminToken(token) {
  const secret = configuredPassword();
  if (!secret || typeof token !== 'string') return false;
  const [issuedAt, signature, extra] = token.split('.');
  if (!issuedAt || !signature || extra) return false;
  const time = Number(issuedAt); const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(time) || time > now + 60 || now - time > SESSION_TTL_SECONDS) return false;
  const a = Buffer.from(signature); const b = Buffer.from(sign(`artiste:${issuedAt}`, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export async function isAdminRequest() {
  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get(ADMIN_COOKIE)?.value || '');
}
