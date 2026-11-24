import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOTIFICATION_SKIP_REASON_VALUES } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { ADAPTER_ERROR_KINDS } from '../adapter-errors';

const LOCALES = ['en', 'hi'] as const;
const FALLBACK = 'other';

/** The institute delivery log shows `reasons.<skip reason or error code>`, else `reasons.other`. */
function reasonKeys(locale: (typeof LOCALES)[number]): string[] {
  const file = resolve(
    __dirname,
    `../../../../../web/messages/${locale}/notificationDelivery.json`,
  );
  const messages: { reasons?: Record<string, string> } = JSON.parse(readFileSync(file, 'utf8'));
  return Object.keys(messages.reasons ?? {});
}

describe('delivery reason copy in the web app', () => {
  it.each(LOCALES)('should give every skip reason its own %s copy', (locale) => {
    const keys = reasonKeys(locale);

    expect(NOTIFICATION_SKIP_REASON_VALUES.filter((reason) => !keys.includes(reason))).toEqual([]);
  });

  it.each(
    LOCALES,
  )('should have the %s fallback for error codes without their own copy', (locale) => {
    expect(reasonKeys(locale)).toContain(FALLBACK);
  });

  it.each(
    LOCALES,
  )('should hold no %s key that is not a skip reason, an error code or the fallback', (locale) => {
    const known = new Set<string>([
      ...NOTIFICATION_SKIP_REASON_VALUES,
      ...Object.keys(ADAPTER_ERROR_KINDS),
      FALLBACK,
    ]);

    expect(reasonKeys(locale).filter((key) => !known.has(key))).toEqual([]);
  });
});
