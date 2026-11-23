import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

function getEncryptionKey() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for portal password storage.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(`artiste-role-password-encryption-v1|${serviceKey}`)
    .digest();
}

function createScryptHash(password) {
  const salt = crypto.randomBytes(16);

  const derived = crypto.scryptSync(
    String(password),
    salt,
    SCRYPT_KEY_LENGTH,
    {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }
  );

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function encryptPortalPasswordHash(scryptHash) {
  const value = String(scryptHash || '');

  if (value.startsWith('enc:v1:')) {
    return value;
  }

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    'enc:v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

function decryptPortalPasswordHash(value) {
  const encoded = String(value || '');

  if (!encoded.startsWith('enc:v1:')) {
    return encoded;
  }

  const parts = encoded.split(':');
  if (parts.length !== 5) return '';

  try {
    const [, , ivPart, tagPart, ciphertextPart] = parts;

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivPart, 'base64url')
    );

    decipher.setAuthTag(
      Buffer.from(tagPart, 'base64url')
    );

    return Buffer.concat([
      decipher.update(
        Buffer.from(ciphertextPart, 'base64url')
      ),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export function hashPortalPassword(password) {
  return encryptPortalPasswordHash(
    createScryptHash(password)
  );
}

export function verifyPortalPassword(storedHash, password) {
  try {
    const decoded = decryptPortalPasswordHash(storedHash);
    const parts = decoded.split('$');

    if (
      parts.length !== 6 ||
      parts[0] !== 'scrypt'
    ) {
      return false;
    }

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);

    if (
      N !== SCRYPT_N ||
      r !== SCRYPT_R ||
      p !== SCRYPT_P
    ) {
      return false;
    }

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');

    if (
      salt.length !== 16 ||
      expected.length !== SCRYPT_KEY_LENGTH
    ) {
      return false;
    }

    const actual = crypto.scryptSync(
      String(password),
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N,
        r,
        p,
        maxmem: 64 * 1024 * 1024,
      }
    );

    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function isEncryptedPortalPasswordHash(value) {
  return String(value || '').startsWith('enc:v1:');
}
