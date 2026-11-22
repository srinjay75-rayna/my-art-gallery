import crypto from 'node:crypto';
import { requireServiceRole } from '@/lib/supabase';

const memoryWindows = new Map();
const MAX_MEMORY_KEYS = 5000;

function clientAddress(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const candidate = forwarded.split(',')[0].trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
  return candidate.slice(0, 100);
}

function memoryLimit(key, limit, windowSeconds) {
  const now = Date.now();
  let bucket = memoryWindows.get(key);
  if (!bucket || now - bucket.startedAt >= windowSeconds * 1000) {
    bucket = { startedAt: now, count: 0 };
    memoryWindows.set(key, bucket);
  }
  bucket.count += 1;
  if (memoryWindows.size > MAX_MEMORY_KEYS) {
    for (const [storedKey, value] of memoryWindows) {
      if (now - value.startedAt > 60 * 60 * 1000) memoryWindows.delete(storedKey);
    }
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.startedAt + windowSeconds * 1000 - now) / 1000));
  return { allowed: bucket.count <= limit, retryAfterSeconds, remaining: Math.max(0, limit - bucket.count), source: 'memory' };
}

/**
 * Uses an atomic Supabase RPC in production so rate limits are shared between
 * serverless instances. Local memory is only a development fallback; a
 * production deployment fails closed if the SQL migration is missing.
 */
export async function enforceRateLimit(request, { scope, identifier, limit, windowSeconds }) {
  const secret = process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return { allowed: false, unavailable: true, retryAfterSeconds: windowSeconds };

  const subject = identifier === undefined || identifier === null
    ? clientAddress(request)
    : String(identifier).trim().toLowerCase().slice(0, 256);
  const keyHash = crypto.createHmac('sha256', secret)
    .update(`${String(scope).slice(0, 80)}|${subject}`)
    .digest('hex');

  try {
    const supabase = requireServiceRole();
    const { data, error } = await supabase.rpc('consume_api_rate_limit', {
      p_key_hash: keyHash,
      p_limit: Math.max(1, Math.min(10000, Number(limit) || 1)),
      p_window_seconds: Math.max(1, Math.min(86400, Number(windowSeconds) || 60)),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') throw new Error('Rate-limit RPC returned an invalid result.');
    return {
      allowed: row.allowed,
      retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || Number(windowSeconds) || 60),
      remaining: Math.max(0, Number(row.remaining) || 0),
      source: 'database',
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Artiste database rate limiter unavailable:', error?.message || error);
      return { allowed: false, unavailable: true, retryAfterSeconds: windowSeconds };
    }
    return memoryLimit(keyHash, limit, windowSeconds);
  }
}

export async function readJsonBody(request, maxBytes = 16 * 1024) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    const error = new Error('Request body is too large.');
    error.status = 413;
    throw error;
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const error = new Error('Request body is too large.');
    error.status = 413;
    throw error;
  }
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('Request body must be a JSON object.');
      error.status = 400;
      throw error;
    }
    return parsed;
  } catch (error) {
    if (Number(error?.status) === 400) throw error;
    const invalid = new Error('Request must contain valid JSON.');
    invalid.status = 400;
    throw invalid;
  }
}

export function cleanText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function rateLimitJsonResponse(NextResponse, result, message = 'Too many requests. Please try again shortly.') {
  const status = result?.unavailable ? 503 : 429;
  return NextResponse.json(
    { error: result?.unavailable ? 'The security rate limiter is temporarily unavailable. Please try again shortly.' : message },
    { status, headers: { 'Retry-After': String(Math.max(1, Number(result?.retryAfterSeconds) || 60)) } },
  );
}
