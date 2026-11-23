import { ConfigService } from '@nestjs/config';
import { MessagingTokenCipher } from '@roviq/crypto';
import { describe, expect, it } from 'vitest';
import { DEV_MESSAGING_ENCRYPTION_KEY, validate } from '../env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://roviq_pooler@localhost/roviq',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  S3_ENDPOINT: 'http://localhost:9002',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9002',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET_PRIVATE: 'roviq-private',
  S3_BUCKET_PUBLIC: 'roviq-public',
  S3_PUBLIC_BASE_URL: 'http://localhost:9002/roviq-public',
  JWT_SECRET: 'jwt',
  JWT_REFRESH_SECRET: 'jwt-refresh',
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_RP_NAME: 'Roviq',
  ALLOWED_ORIGINS: 'http://localhost:4200',
};
const REAL_KEY = 'ab'.repeat(32);

describe('api-gateway env validation: MESSAGING_ENCRYPTION_KEY', () => {
  it('should fill in the development key outside production when it is unset', () => {
    expect(validate({ ...BASE, NODE_ENV: 'development' }).MESSAGING_ENCRYPTION_KEY).toBe(
      DEV_MESSAGING_ENCRYPTION_KEY,
    );
    expect(validate(BASE).MESSAGING_ENCRYPTION_KEY).toBe(DEV_MESSAGING_ENCRYPTION_KEY);
  });

  it('should give the cipher a working key from the validated config when the variable is unset', () => {
    const cipher = new MessagingTokenCipher(
      new ConfigService(validate(BASE)).getOrThrow<string>('MESSAGING_ENCRYPTION_KEY'),
    );

    expect(cipher.decrypt(cipher.encrypt('token'))).toBe('token');
  });

  it('should keep a key that is set', () => {
    expect(validate({ ...BASE, MESSAGING_ENCRYPTION_KEY: REAL_KEY }).MESSAGING_ENCRYPTION_KEY).toBe(
      REAL_KEY,
    );
  });

  it('should require the key in production', () => {
    expect(() => validate({ ...BASE, NODE_ENV: 'production' })).toThrow(
      'MESSAGING_ENCRYPTION_KEY — required in production',
    );
  });

  it('should refuse the all-zero development key in production', () => {
    expect(() =>
      validate({
        ...BASE,
        NODE_ENV: 'production',
        MESSAGING_ENCRYPTION_KEY: DEV_MESSAGING_ENCRYPTION_KEY,
      }),
    ).toThrow('MESSAGING_ENCRYPTION_KEY — the all-zero development key is refused in production');
  });

  it('should accept a real key in production', () => {
    expect(
      validate({ ...BASE, NODE_ENV: 'production', MESSAGING_ENCRYPTION_KEY: REAL_KEY })
        .MESSAGING_ENCRYPTION_KEY,
    ).toBe(REAL_KEY);
  });

  it.each([
    'development',
    'test',
    'production',
  ])('should refuse a malformed key when NODE_ENV is %s', (nodeEnv) => {
    for (const key of ['', 'abc', 'g'.repeat(64), '0'.repeat(63)]) {
      expect(() => validate({ ...BASE, NODE_ENV: nodeEnv, MESSAGING_ENCRYPTION_KEY: key })).toThrow(
        'MESSAGING_ENCRYPTION_KEY — must be 64 hex characters',
      );
    }
  });
});
