import { describe, expect, it } from 'vitest';
import { SMS_TEMPLATE_IDS_ERROR, SmsRegistrations } from '../sms-registrations';

describe('SmsRegistrations', () => {
  it('should find the registration id of each key', () => {
    const registrations = new SmsRegistrations(
      JSON.stringify({ 'AUTH_OTP:en': 'reg-1001', 'AUTH_OTP:hi': 'reg-1002' }),
    );

    expect(registrations.idFor('AUTH_OTP:en')).toBe('reg-1001');
    expect(registrations.idFor('AUTH_OTP:hi')).toBe('reg-1002');
  });

  it('should answer null for a key without a registration', () => {
    const registrations = new SmsRegistrations(JSON.stringify({ 'AUTH_OTP:en': 'reg-1001' }));

    expect(registrations.idFor('FEE_REMINDER:en')).toBeNull();
    expect(registrations.idFor('AUTH_OTP')).toBeNull();
  });

  it('should accept an empty object', () => {
    expect(new SmsRegistrations('{}').idFor('AUTH_OTP:en')).toBeNull();
  });

  it.each([
    ['not JSON', '{secret-7391: reg'],
    ['an array', '["secret-7391"]'],
    ['a string', '"secret-7391"'],
    ['null', 'null'],
    ['a number value', '{"AUTH_OTP:en": 7391}'],
    ['an empty string value', '{"AUTH_OTP:en": "", "secret-7391": "x"}'],
    ['a blank value', '{"AUTH_OTP:en": "  ", "secret-7391": "x"}'],
    ['an empty key', '{"": "secret-7391"}'],
  ])('should refuse %s without echoing the content', (_case, raw) => {
    const error = (() => {
      try {
        new SmsRegistrations(raw);
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('expected an Error');
    expect(error.message).toBe(SMS_TEMPLATE_IDS_ERROR);
    expect(error.message).toContain('SMS_TEMPLATE_IDS');
    expect(error.message).not.toContain('secret-7391');
    expect(error.message).not.toContain('7391');
    expect(error.cause).toBeUndefined();
  });
});
