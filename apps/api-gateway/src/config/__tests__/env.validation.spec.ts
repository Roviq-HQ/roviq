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
/** Storage as production needs it: https, its own domain, two buckets. */
const PROD = {
  ...BASE,
  S3_ENDPOINT: 'http://object-storage:9000',
  S3_PUBLIC_ENDPOINT: 'https://storage.example.test',
  S3_PUBLIC_BASE_URL: 'https://files.example.test',
  ALLOWED_ORIGINS: 'https://app.example.test,https://admin.app.example.test',
  MESSAGING_ENCRYPTION_KEY: REAL_KEY,
};

describe('api-gateway env validation: MESSAGING_ENCRYPTION_KEY', () => {
  it('should fill in the development key in development and test when it is unset', () => {
    expect(validate({ ...BASE, NODE_ENV: 'development' }).MESSAGING_ENCRYPTION_KEY).toBe(
      DEV_MESSAGING_ENCRYPTION_KEY,
    );
    expect(validate({ ...BASE, NODE_ENV: 'test' }).MESSAGING_ENCRYPTION_KEY).toBe(
      DEV_MESSAGING_ENCRYPTION_KEY,
    );
  });

  it('should give the cipher a working key from the validated config when the variable is unset', () => {
    const cipher = new MessagingTokenCipher(
      new ConfigService(validate({ ...BASE, NODE_ENV: 'test' })).getOrThrow<string>(
        'MESSAGING_ENCRYPTION_KEY',
      ),
    );

    expect(cipher.decrypt(cipher.encrypt('token'))).toBe('token');
  });

  it('should keep a key that is set', () => {
    expect(validate(PROD).MESSAGING_ENCRYPTION_KEY).toBe(REAL_KEY);
  });

  it.each([
    'production',
    'staging',
    undefined,
  ])('should require the key when NODE_ENV is %s', (nodeEnv) => {
    expect(() => validate({ ...BASE, NODE_ENV: nodeEnv })).toThrow(
      'MESSAGING_ENCRYPTION_KEY — required unless NODE_ENV is development or test',
    );
  });

  it('should refuse the all-zero development key outside development and test', () => {
    expect(() =>
      validate({ ...BASE, MESSAGING_ENCRYPTION_KEY: DEV_MESSAGING_ENCRYPTION_KEY }),
    ).toThrow('MESSAGING_ENCRYPTION_KEY — the all-zero development key is refused');
    expect(() =>
      validate({
        ...BASE,
        NODE_ENV: 'production',
        MESSAGING_ENCRYPTION_KEY: DEV_MESSAGING_ENCRYPTION_KEY,
      }),
    ).toThrow('MESSAGING_ENCRYPTION_KEY — the all-zero development key is refused');
  });

  it('should accept a real key in production', () => {
    expect(validate({ ...PROD, NODE_ENV: 'production' }).MESSAGING_ENCRYPTION_KEY).toBe(REAL_KEY);
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

describe('api-gateway env validation: telemetry variables', () => {
  const TEST_ENV = { ...BASE, NODE_ENV: 'test' };

  it('should accept an environment with telemetry off', () => {
    expect(() => validate(TEST_ENV)).not.toThrow();
  });

  it('should accept an endpoint with an authorization header whose value has a space and padding', () => {
    const config = {
      ...TEST_ENV,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openobserve:5081',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Basic b3BzOnBhc3M=,organization=default',
    };

    expect(() => validate(config)).not.toThrow();
  });

  it('should refuse an endpoint that is not a URL', () => {
    expect(() => validate({ ...TEST_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: 'openobserve' })).toThrow(
      /OTEL_EXPORTER_OTLP_ENDPOINT/,
    );
  });

  it('should refuse headers that are not key=value pairs', () => {
    expect(() =>
      validate({ ...TEST_ENV, OTEL_EXPORTER_OTLP_HEADERS: 'Basic b3BzOnBhc3M' }),
    ).toThrow(/OTEL_EXPORTER_OTLP_HEADERS/);
  });

  it('should refuse an OpenObserve address that is not an http URL', () => {
    expect(() => validate({ ...TEST_ENV, OPENOBSERVE_URL: 'openobserve:5080/x y' })).toThrow(
      /OPENOBSERVE_URL/,
    );
  });
});

describe('api-gateway env validation: object storage outside development and test', () => {
  const PRODUCTION = { ...PROD, NODE_ENV: 'production' };

  it('should accept https browser endpoints on their own domain with a private server endpoint', () => {
    expect(() => validate(PRODUCTION)).not.toThrow();
    expect(() =>
      validate({ ...PRODUCTION, S3_ENDPOINT: 'https://s3.storage.example.test' }),
    ).not.toThrow();
  });

  it.each([
    'S3_PUBLIC_ENDPOINT',
    'S3_PUBLIC_BASE_URL',
  ] as const)('should refuse a plain http %s', (name) => {
    expect(() => validate({ ...PRODUCTION, [name]: 'http://storage.example.test' })).toThrow(
      `${name} — must be https outside development and test`,
    );
  });

  it('should refuse a plain http server endpoint on a public host', () => {
    expect(() =>
      validate({ ...PRODUCTION, S3_ENDPOINT: 'http://s3.storage.example.test' }),
    ).toThrow('S3_ENDPOINT — must be https unless it is a private host');
  });

  it.each([
    'S3_PUBLIC_ENDPOINT',
    'S3_PUBLIC_BASE_URL',
  ] as const)('should refuse %s on a portal host', (name) => {
    expect(() =>
      validate({ ...PRODUCTION, [name]: 'https://admin.app.example.test/files' }),
    ).toThrow(`${name} — must not be a portal host from ALLOWED_ORIGINS`);
  });

  it('should refuse one bucket for both private and public files', () => {
    expect(() =>
      validate({ ...PRODUCTION, S3_BUCKET_PUBLIC: PRODUCTION.S3_BUCKET_PRIVATE }),
    ).toThrow('S3_BUCKET_PUBLIC — must differ from S3_BUCKET_PRIVATE');
  });

  it('should leave the http dev store alone in development and test', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(() => validate({ ...BASE, NODE_ENV: nodeEnv })).not.toThrow();
    }
  });
});
