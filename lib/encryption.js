import crypto from 'node:crypto';

function encryptionKey() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('Set PAYOUT_ENCRYPTION_KEY to a base64-encoded 32-byte secret before saving Artist bank details.');
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error('PAYOUT_ENCRYPTION_KEY must decode to exactly 32 bytes. Generate it with: openssl rand -base64 32');
  return key;
}

export function encryptPayoutValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptPayoutValue(value) {
  const [ivText, tagText, cipherText] = String(value || '').split('.');
  if (!ivText || !tagText || !cipherText) throw new Error('Encrypted payout account data is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64url')), decipher.final()]).toString('utf8');
}

export function maskBankAccount(value) {
  const digits = String(value || '').replace(/\s/g, '');
  return digits.length >= 4 ? `•••• •••• ${digits.slice(-4)}` : 'Not provided';
}
