import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/env';

export const ENCRYPTED_ACCOUNT_NUMBER_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function parseKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('Account-number encryption keys must be base64-encoded 32-byte values');
  }
  return key;
}

// Construct the key ring once at startup. A malformed or missing key prevents
// the app from serving requests rather than silently persisting plaintext data.
const encryptionKeys = [
  config.accountNumberEncryptionKey,
  ...config.accountNumberEncryptionPreviousKeys,
].map(parseKey);

function parseEnvelope(value: string): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const parts = value.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== ENCRYPTED_ACCOUNT_NUMBER_PREFIX) {
    throw new Error('Invalid encrypted account-number envelope');
  }

  const [, , ivValue, authTagValue, ciphertextValue] = parts;
  const iv = Buffer.from(ivValue, 'base64');
  const authTag = Buffer.from(authTagValue, 'base64');
  const ciphertext = Buffer.from(ciphertextValue, 'base64');

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) {
    throw new Error('Invalid encrypted account-number envelope');
  }

  return { iv, authTag, ciphertext };
}

function decryptWithKey(value: string, key: Buffer): string {
  const { iv, authTag, ciphertext } = parseEnvelope(value);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncryptedAccountNumber(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_ACCOUNT_NUMBER_PREFIX);
}

export function encryptAccountNumber(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKeys[0], iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_ACCOUNT_NUMBER_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptAccountNumber(value: string | null | undefined): string | null | undefined {
  if (!isEncryptedAccountNumber(value)) {
    // Legacy values remain readable only until the backfill command has run.
    return value;
  }

  for (const key of encryptionKeys) {
    try {
      return decryptWithKey(value, key);
    } catch {
      // A previous key may legitimately fail GCM authentication; try the next.
    }
  }

  throw new Error('Encrypted account number cannot be decrypted with the configured keys');
}

export function isEncryptedWithPrimaryKey(value: string): boolean {
  if (!isEncryptedAccountNumber(value)) {
    return false;
  }

  try {
    decryptWithKey(value, encryptionKeys[0]);
    return true;
  } catch {
    return false;
  }
}
