import { describe, expect, it } from 'vitest';

import { getLocaleMessages } from '../messages';

// Hardcoded for the same reason as messages.spec.ts: no next-intl server deps in this spec.
const locales = ['en', 'hi'] as const;

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

// A key missing in one locale falls back to English or shows the raw key; both reach users.
describe('i18n message key parity', () => {
  const reference = leafKeys(getLocaleMessages(locales[0])).sort();

  for (const locale of locales.slice(1)) {
    it(`${locale} has exactly the leaf keys of ${locales[0]}`, () => {
      const keys = new Set(leafKeys(getLocaleMessages(locale)));
      const referenceKeys = new Set(reference);
      expect({
        missingIn: [...referenceKeys].filter((key) => !keys.has(key)),
        extraIn: [...keys].filter((key) => !referenceKeys.has(key)),
      }).toEqual({ missingIn: [], extraIn: [] });
    });
  }
});
