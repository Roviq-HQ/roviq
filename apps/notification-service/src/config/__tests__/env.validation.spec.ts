import { describe, expect, it } from 'vitest';
import { validate } from '../env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://roviq_pooler@localhost/roviq',
  NATS_URL: 'nats://localhost:4222',
};

describe('notification-service env validation', () => {
  it('should accept no providers at all', () => {
    expect(validate(BASE)).toEqual(BASE);
  });

  it('should require SMTP_URL and EMAIL_FROM for the smtp provider', () => {
    expect(() => validate({ ...BASE, NOTIFICATION_EMAIL_PROVIDER: 'smtp' })).toThrow(
      'SMTP_URL and EMAIL_FROM — required when NOTIFICATION_EMAIL_PROVIDER=smtp',
    );
  });

  it('should require the service account for the fcm provider', () => {
    expect(() => validate({ ...BASE, NOTIFICATION_PUSH_PROVIDER: 'fcm' })).toThrow(
      'FCM_SERVICE_ACCOUNT_JSON — required when NOTIFICATION_PUSH_PROVIDER=fcm',
    );
  });

  it('should refuse the log provider in production', () => {
    expect(() =>
      validate({
        ...BASE,
        NODE_ENV: 'production',
        NOTIFICATION_SMS_PROVIDER: 'log',
        NOTIFICATION_WHATSAPP_PROVIDER: 'log',
      }),
    ).toThrow(
      "NOTIFICATION_SMS_PROVIDER, NOTIFICATION_WHATSAPP_PROVIDER — the 'log' provider sends nothing and is refused in production",
    );
  });

  it('should accept the log provider outside production', () => {
    const env = { ...BASE, NODE_ENV: 'test', NOTIFICATION_SMS_PROVIDER: 'log' };

    expect(validate(env)).toEqual(env);
  });

  describe('the WhatsApp cloud provider', () => {
    const CLOUD = {
      ...BASE,
      NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
      WHATSAPP_API_BASE_URL: 'https://graph.example.test/v99.0',
      WHATSAPP_APP_SECRET: 'fake-app-secret',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake-verify-token',
      MESSAGING_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
    };

    it('should accept the provider with all four settings', () => {
      expect(validate(CLOUD)).toEqual(CLOUD);
    });

    it.each([
      'WHATSAPP_API_BASE_URL',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'MESSAGING_ENCRYPTION_KEY',
    ] as const)('should name %s when it is missing', (name) => {
      const { [name]: _missing, ...env } = CLOUD;

      expect(() => validate(env)).toThrow(
        `${name} — required when NOTIFICATION_WHATSAPP_PROVIDER=cloud`,
      );
    });

    it('should name every missing setting at once', () => {
      expect(() => validate({ ...BASE, NOTIFICATION_WHATSAPP_PROVIDER: 'cloud' })).toThrow(
        'WHATSAPP_API_BASE_URL, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN, MESSAGING_ENCRYPTION_KEY — required when NOTIFICATION_WHATSAPP_PROVIDER=cloud',
      );
    });

    it.each([
      ['too short', '0123456789abcdef'],
      ['too long', `${'0123456789abcdef'.repeat(4)}00`],
      ['not hex', 'g'.repeat(64)],
    ])('should refuse an encryption key that is %s', (_case, key) => {
      expect(() => validate({ ...CLOUD, MESSAGING_ENCRYPTION_KEY: key })).toThrow(
        'MESSAGING_ENCRYPTION_KEY — 64 hex characters (32 bytes)',
      );
    });

    it('should refuse an API address that is not a URL', () => {
      expect(() => validate({ ...CLOUD, WHATSAPP_API_BASE_URL: 'not a url' })).toThrow(
        'Invalid notification-service environment',
      );
    });

    it.each([
      ['log', { ...BASE, NOTIFICATION_WHATSAPP_PROVIDER: 'log' }],
      ['unset', BASE],
    ])('should need none of the settings when the provider is %s', (_case, env) => {
      expect(validate(env)).toEqual(env);
    });
  });

  describe('the SMS http provider', () => {
    const HTTP = {
      ...BASE,
      NOTIFICATION_SMS_PROVIDER: 'http',
      SMS_API_BASE_URL: 'https://sms.example.test/api/v5',
      SMS_API_KEY: 'fake-auth-key',
      SMS_TEMPLATE_IDS: JSON.stringify({ 'AUTH_OTP:en': 'reg-1001' }),
      SMS_WEBHOOK_SECRET: 'w'.repeat(32),
    };

    it('should accept the provider with all four settings', () => {
      expect(validate(HTTP)).toEqual(HTTP);
    });

    it('should accept the optional sender header', () => {
      const env = { ...HTTP, SMS_SENDER_ID: 'ROVIQS' };

      expect(validate(env)).toEqual(env);
    });

    it.each([
      'SMS_API_BASE_URL',
      'SMS_API_KEY',
      'SMS_TEMPLATE_IDS',
      'SMS_WEBHOOK_SECRET',
    ] as const)('should name %s when it is missing', (name) => {
      const { [name]: _missing, ...env } = HTTP;

      expect(() => validate(env)).toThrow(`${name} — required when NOTIFICATION_SMS_PROVIDER=http`);
    });

    it('should name every missing setting at once', () => {
      expect(() => validate({ ...BASE, NOTIFICATION_SMS_PROVIDER: 'http' })).toThrow(
        'SMS_API_BASE_URL, SMS_API_KEY, SMS_TEMPLATE_IDS, SMS_WEBHOOK_SECRET — required when NOTIFICATION_SMS_PROVIDER=http',
      );
    });

    it('should refuse a webhook secret shorter than 32 characters', () => {
      expect(() => validate({ ...HTTP, SMS_WEBHOOK_SECRET: 'w'.repeat(31) })).toThrow(
        'SMS_WEBHOOK_SECRET — at least 32 characters',
      );
    });

    it.each([
      ['not JSON', '{reg-secret-9'],
      ['an array', '["reg-secret-9"]'],
      ['a number value', '{"AUTH_OTP:en": 9}'],
      ['an empty value', '{"AUTH_OTP:en": "", "reg-secret-9": "x"}'],
    ])('should refuse template ids that are %s without printing them', (_case, raw) => {
      const error = (() => {
        try {
          validate({ ...HTTP, SMS_TEMPLATE_IDS: raw });
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error('expected an Error');
      expect(error.message).toContain('SMS_TEMPLATE_IDS — must be a JSON object');
      expect(error.message).not.toContain('reg-secret-9');
    });

    it('should refuse an API address that is not a URL', () => {
      expect(() => validate({ ...HTTP, SMS_API_BASE_URL: 'not a url' })).toThrow(
        'Invalid notification-service environment',
      );
    });

    it.each([
      ['log', { ...BASE, NOTIFICATION_SMS_PROVIDER: 'log' }],
      ['unset', BASE],
    ])('should need none of the settings when the provider is %s', (_case, env) => {
      expect(validate(env)).toEqual(env);
    });
  });
});
