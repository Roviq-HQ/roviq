import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { IdentityCryptoService, MessagingTokenCipher } from '../encrypted-field';

const TEST_KEY = randomBytes(32).toString('hex');

function createService(key = TEST_KEY): IdentityCryptoService {
  const config = {
    getOrThrow: (k: string) => {
      if (k === 'IDENTITY_ENCRYPTION_KEY') return key;
      throw new Error(`Unexpected key: ${k}`);
    },
  } as ConfigService;
  return new IdentityCryptoService(config);
}

describe('IdentityCryptoService', () => {
  it('roundtrip: encrypt → decrypt returns original plaintext', () => {
    const service = createService();
    const plaintext = '123456789012';
    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same input (random IV)', () => {
    const service = createService();
    const plaintext = '123456789012';
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a.equals(b)).toBe(false);
  });

  it('output is Buffer with IV (12) + authTag (16) + ciphertext', () => {
    const service = createService();
    const encrypted = service.encrypt('test');
    // Minimum size: 12 + 16 + 1 byte of ciphertext = 29
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(encrypted.length).toBeGreaterThanOrEqual(29);
  });

  it('handles empty string', () => {
    const service = createService();
    const encrypted = service.encrypt('');
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('handles Unicode (Hindi Aadhaar holder name)', () => {
    const service = createService();
    const plaintext = 'राज कुमार शर्मा';
    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const service = createService();
    const encrypted = service.encrypt('sensitive');
    // Flip a byte in the ciphertext portion
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => service.decrypt(encrypted)).toThrow();
  });

  it('throws on wrong key length', () => {
    expect(() => createService('tooshort')).toThrow('64-character hex string');
  });
});

describe('MessagingTokenCipher', () => {
  const configWith = (values: Record<string, string>) =>
    ({
      getOrThrow: (k: string) => {
        const value = values[k];
        if (value === undefined) throw new Error(`Unexpected key: ${k}`);
        return value;
      },
    }) as ConfigService;

  it('reads its own key and returns the token it was given', () => {
    const cipher = new MessagingTokenCipher(configWith({ MESSAGING_ENCRYPTION_KEY: TEST_KEY }));
    const sealed = cipher.encrypt('token-with-ünicode');
    expect(sealed.toString('utf8')).not.toContain('token-with');
    expect(cipher.decrypt(sealed)).toBe('token-with-ünicode');
  });

  it('cannot open what the identity key sealed', () => {
    const identity = createService(randomBytes(32).toString('hex'));
    const cipher = new MessagingTokenCipher(configWith({ MESSAGING_ENCRYPTION_KEY: TEST_KEY }));
    expect(() => cipher.decrypt(identity.encrypt('secret'))).toThrow();
  });

  it('refuses a key that is not 64 hex characters', () => {
    expect(
      () => new MessagingTokenCipher(configWith({ MESSAGING_ENCRYPTION_KEY: 'z'.repeat(64) })),
    ).toThrow(/MESSAGING_ENCRYPTION_KEY must be a 64-character hex string/);
  });
});
