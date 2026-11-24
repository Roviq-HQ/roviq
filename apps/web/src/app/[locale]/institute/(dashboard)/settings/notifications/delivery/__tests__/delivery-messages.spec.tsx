import { NOTIFICATION_SKIP_REASON_VALUES, NOTIFICATION_TYPE_VALUES } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import en from '../../../../../../../../../messages/en/notificationDelivery.json';
import hi from '../../../../../../../../../messages/hi/notificationDelivery.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('notificationDelivery messages', () => {
  it('has the same keys in en and hi', () => {
    expect(keyPaths(hi).sort()).toEqual(keyPaths(en).sort());
  });

  for (const [locale, messages] of [
    ['en', en],
    ['hi', hi],
  ] as const) {
    it(`${locale}: every skip reason and the fallback have non-empty copy`, () => {
      const reasons: Record<string, string> = messages.reasons;
      for (const code of [...NOTIFICATION_SKIP_REASON_VALUES, 'other']) {
        expect(reasons[code], `${locale} reasons.${code}`).toMatch(/\S/);
      }
    });

    it(`${locale}: every notification type has a name`, () => {
      const types: Record<string, string> = messages.types;
      for (const type of NOTIFICATION_TYPE_VALUES) {
        expect(types[type], `${locale} types.${type}`).toMatch(/\S/);
      }
    });
  }

  it('Hindi reasons are written in Devanagari, not transliterated', () => {
    for (const [code, text] of Object.entries(hi.reasons)) {
      expect(text, `hi reasons.${code}`).toMatch(/[ऀ-ॿ]/);
    }
  });
});
