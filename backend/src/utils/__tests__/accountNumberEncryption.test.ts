import { describe, expect, it } from 'vitest';
import {
  decryptAccountNumber,
  encryptAccountNumber,
  isEncryptedAccountNumber,
} from '../accountNumberEncryption';

describe('account-number encryption', () => {
  it('uses randomized authenticated ciphertext and decrypts it for an authorized response', () => {
    const first = encryptAccountNumber('123456789012');
    const second = encryptAccountNumber('123456789012');

    expect(first).not.toBe('123456789012');
    expect(second).not.toBe('123456789012');
    expect(first).not.toBe(second);
    expect(isEncryptedAccountNumber(first)).toBe(true);
    expect(decryptAccountNumber(first)).toBe('123456789012');
  });

  it('rejects a tampered ciphertext instead of returning unauthenticated data', () => {
    const encrypted = encryptAccountNumber('123456789012');
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

    expect(() => decryptAccountNumber(tampered)).toThrow('cannot be decrypted');
  });

  it('keeps legacy plaintext readable only for the migration window', () => {
    expect(decryptAccountNumber('legacy-number')).toBe('legacy-number');
  });
});
