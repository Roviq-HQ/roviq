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
});
