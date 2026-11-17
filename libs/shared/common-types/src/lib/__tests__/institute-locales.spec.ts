import { describe, expect, it } from 'vitest';
import { validInstituteLocales } from '../institute-locales';

describe('validInstituteLocales', () => {
  it('accepts English plus a regional default', () => {
    expect(validInstituteLocales({ supportedLocales: ['en', 'ta'], defaultLocale: 'ta' })).toBe(
      true,
    );
  });
  it.each([
    { supportedLocales: [], defaultLocale: 'en' },
    { supportedLocales: ['ta'], defaultLocale: 'ta' },
    { supportedLocales: ['en'], defaultLocale: 'ta' },
    { supportedLocales: ['en', 'en'], defaultLocale: 'en' },
    { supportedLocales: ['en', 'zz'], defaultLocale: 'en' },
    { supportedLocales: ['en', '__proto__'], defaultLocale: 'en' },
  ])('rejects invalid settings %j', (settings) => {
    expect(validInstituteLocales(settings)).toBe(false);
  });
});
