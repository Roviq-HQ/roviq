import assert from 'node:assert';
import { describe, expect, it } from 'vitest';
import { composeSecret } from '../../../types/compose';
import { LOCALES, type Locale } from '../../../types/notification-type';
import { REGULAR_TYPES, SECRET_TYPES, type SecretPayload } from '../../../types/registry';
import { placeholdersOf, renderTemplate } from '../../whatsapp/whatsapp-template';
import { isGsm7, SMS_VARIABLE_MAX, SmsVariableError, smsSegments } from '../sms-template';
import { SMS_TEMPLATES, smsDraftForRegular, smsDraftForSecret } from '../sms-templates';

const CODE = '482913';
const PASSWORD = 'Ab3dEf6hIj9lMn2pQr5tUv';
const LONG_INSTITUTE_EN = 'Sunrise Public Senior Secondary Institute of Science, Jaipur';
const LONG_INSTITUTE_HI = 'सनराइज़ पब्लिक सीनियर सेकेंडरी विज्ञान संस्थान, जयपुर, राजस्थान राज्य';
const LONG_FIRST_NAME = 'Kiranmayee Venkatalakshmi Subrahmanyam Iyengar';

const OTP: SecretPayload = { type: 'IMPERSONATION_OTP', params: { otp: CODE } };
const WELCOME_FROM_INSTITUTE: SecretPayload = {
  type: 'USER_WELCOME',
  params: {
    username: 'staff-0191-ab12',
    firstName: LONG_FIRST_NAME,
    tempPassword: PASSWORD,
    institute: {
      name: { en: LONG_INSTITUTE_EN, hi: LONG_INSTITUTE_HI },
      signInUrl: 'https://app.roviq.com/login',
    },
  },
};
const WELCOME_WITHOUT_NAME: SecretPayload = {
  type: 'USER_WELCOME',
  params: {
    username: 'staff-0191-ab12',
    firstName: null,
    tempPassword: PASSWORD,
    institute: { name: { en: '  ' }, signInUrl: 'https://app.roviq.com/login' },
  },
};
const WELCOME_PLAIN = {
  type: 'USER_WELCOME',
  params: { username: 'priya.verma', firstName: null, tempPassword: PASSWORD, institute: null },
} satisfies SecretPayload;
const VERIFICATION: SecretPayload = { type: 'EMAIL_VERIFICATION', params: { code: CODE } };

const SAMPLES = [OTP, WELCOME_FROM_INSTITUTE, WELCOME_WITHOUT_NAME, WELCOME_PLAIN, VERIFICATION];
const SMS_SAMPLES = [OTP, WELCOME_FROM_INSTITUTE, WELCOME_WITHOUT_NAME, WELCOME_PLAIN];
const PLACEHOLDER = /\{\{\d+\}\}/;

function smsBody(message: SecretPayload, locale: Locale): string {
  return composeSecret(message.type, message.params, 'SMS', locale).body;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('SMS_TEMPLATES', () => {
  it('should have unique keys', () => {
    const keys = SMS_TEMPLATES.map((t) => t.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should number its placeholders 1..n without gaps, the same in both languages', (_key, template) => {
    const count = placeholdersOf(template.body.en).length;

    expect(count).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const positions = placeholdersOf(template.body[locale]).sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should be a fixed sentence: no edge or adjacent placeholder, no line break', (_key, template) => {
    for (const locale of LOCALES) {
      const body = template.body[locale];
      expect(body.startsWith('Roviq: ')).toBe(true);
      expect(new RegExp(`^${PLACEHOLDER.source}`).test(body)).toBe(false);
      expect(new RegExp(`${PLACEHOLDER.source}$`).test(body)).toBe(false);
      expect(/\}\}\s*\{\{/.test(body)).toBe(false);
      expect(/[\r\n]/.test(body)).toBe(false);
    }
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should list only valid exact positions', (_key, template) => {
    const count = placeholdersOf(template.body.en).length;

    expect(new Set(template.exactPositions).size).toBe(template.exactPositions.length);
    for (const position of template.exactPositions) {
      expect(Number.isInteger(position)).toBe(true);
      expect(position).toBeGreaterThanOrEqual(1);
      expect(position).toBeLessThanOrEqual(count);
    }
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should fit its parts with every variable at its longest', (_key, template) => {
    const count = placeholdersOf(template.body.en).length;
    for (const locale of LOCALES) {
      const values = Array.from({ length: count }, (_, i) =>
        locale === 'hi' && !template.exactPositions.includes(i + 1)
          ? 'क'.repeat(SMS_VARIABLE_MAX)
          : 'W'.repeat(SMS_VARIABLE_MAX),
      );
      const rendered = renderTemplate(template.body[locale], values);
      expect(smsSegments(rendered)).toBeLessThanOrEqual(template.maxSegments[locale]);
    }
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should keep the English text in the 7-bit alphabet', (_key, template) => {
    expect(isGsm7(template.body.en)).toBe(true);
    expect(isGsm7(template.body.hi)).toBe(false);
  });

  it.each(
    SMS_TEMPLATES.map((t) => [t.key, t] as const),
  )('%s should carry no web address', (_key, template) => {
    for (const locale of LOCALES) {
      const body = template.body[locale];
      expect(body).not.toMatch(/http/i);
      expect(body).not.toMatch(/www\./i);
      expect(body).not.toMatch(/\.[A-Za-z]/);
    }
  });
});

describe('smsDraftForSecret', () => {
  it('should cover every secret type in the samples', () => {
    expect(new Set(SAMPLES.map((m) => m.type))).toEqual(new Set(Object.keys(SECRET_TYPES)));
  });

  it.each(
    SAMPLES.map((m) => [m.type, m] as const),
  )('%s should have a draft exactly when the type sends SMS', (_type, message) => {
    const sendsSms = SECRET_TYPES[message.type].channels.includes('SMS');
    for (const locale of LOCALES) {
      const draft = smsDraftForSecret(message, locale);
      expect(draft === null).toBe(!sendsSms);
    }
  });

  it('should give no draft for email verification', () => {
    expect(smsDraftForSecret(VERIFICATION, 'en')).toBeNull();
    expect(smsDraftForSecret(VERIFICATION, 'hi')).toBeNull();
  });

  it.each(
    SMS_SAMPLES.map((m, i) => [i, m] as const),
  )('sample %i: the SMS copy should be the registered template, fitted', (_i, message) => {
    for (const locale of LOCALES) {
      const draft = smsDraftForSecret(message, locale);
      assert(draft);
      const template = SMS_TEMPLATES.find((t) => `${t.key}:${locale}` === draft.registrationKey);
      assert(template);
      expect(smsBody(message, locale)).toBe(renderTemplate(template.body[locale], draft.variables));
      expect(draft.unicode).toBe(locale === 'hi');
      for (const value of draft.variables) {
        expect(value).not.toBe('');
        expect([...value].length).toBeLessThanOrEqual(SMS_VARIABLE_MAX);
      }
    }
  });

  it('should send the impersonation code unchanged', () => {
    expect(smsDraftForSecret(OTP, 'en')).toEqual({
      registrationKey: 'IMPERSONATION_OTP:en',
      variables: [CODE],
      unicode: false,
    });
    expect(smsDraftForSecret(OTP, 'hi')).toEqual({
      registrationKey: 'IMPERSONATION_OTP:hi',
      variables: [CODE],
      unicode: true,
    });
  });

  it('should shorten a long institute name and keep the username and password', () => {
    expect(smsDraftForSecret(WELCOME_FROM_INSTITUTE, 'en')).toEqual({
      registrationKey: 'USER_WELCOME_INSTITUTE:en',
      variables: [`${LONG_INSTITUTE_EN.slice(0, 28).trimEnd()}..`, 'staff-0191-ab12', PASSWORD],
      unicode: false,
    });
    expect(smsDraftForSecret(WELCOME_FROM_INSTITUTE, 'hi')).toEqual({
      registrationKey: 'USER_WELCOME_INSTITUTE:hi',
      variables: [
        `${[...LONG_INSTITUTE_HI].slice(0, 28).join('').trimEnd()}..`,
        'staff-0191-ab12',
        PASSWORD,
      ],
      unicode: true,
    });
  });

  it('should name "your institute" when the institute has no name', () => {
    expect(smsDraftForSecret(WELCOME_WITHOUT_NAME, 'en')?.variables[0]).toBe('Your institute');
    expect(smsDraftForSecret(WELCOME_WITHOUT_NAME, 'hi')?.variables[0]).toBe('आपके संस्थान');
  });

  it('should use the plain welcome when no institute created the account', () => {
    expect(smsDraftForSecret(WELCOME_PLAIN, 'hi')).toEqual({
      registrationKey: 'USER_WELCOME:hi',
      variables: ['priya.verma', PASSWORD],
      unicode: true,
    });
  });

  it('should refuse a username over the limit while the copy still renders', () => {
    const username = 'u'.repeat(SMS_VARIABLE_MAX + 1);
    const message: SecretPayload = {
      type: 'USER_WELCOME',
      params: { ...WELCOME_PLAIN.params, username },
    };

    for (const locale of LOCALES) {
      const err = thrownBy(() => smsDraftForSecret(message, locale));
      assert(err instanceof SmsVariableError);
      expect(err.position).toBe(1);
      expect(err.message).not.toContain(PASSWORD);
      expect(err.message).not.toContain(username);
      expect(smsBody(message, locale)).toContain(username);
      expect(smsBody(message, locale)).toContain(PASSWORD);
    }
  });

  it('should not put a code that is too long into the error', () => {
    const otp = '7'.repeat(SMS_VARIABLE_MAX + 1);
    const err = thrownBy(() =>
      smsDraftForSecret({ type: 'IMPERSONATION_OTP', params: { otp } }, 'en'),
    );

    assert(err instanceof SmsVariableError);
    expect(err.message).not.toContain(otp);
  });
});

describe('smsDraftForRegular', () => {
  it('should match the registry: no regular type lists SMS', () => {
    for (const type of Object.values(REGULAR_TYPES)) expect(type.channels).not.toContain('SMS');
  });

  it('should give no draft while no regular type sends SMS', () => {
    expect(
      smsDraftForRegular(
        {
          type: 'AUTH_LOGIN',
          params: { ip: null, at: '2026-04-10T05:00:00.000Z', accountPath: '/institute/account' },
        },
        'en',
      ),
    ).toBeNull();
  });
});
