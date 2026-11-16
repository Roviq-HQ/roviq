import { defaultLocale, type Locale, locales } from '@roviq/i18n';

export function resolveAccountLocale(
  preference: string | null,
  browserLanguages: readonly string[],
): Locale {
  const saved = locales.find((locale) => locale === preference);
  if (saved) return saved;
  for (const language of browserLanguages) {
    const primary = language.toLowerCase().split('-')[0];
    const match = locales.find((locale) => locale === primary);
    if (match) return match;
  }
  return defaultLocale;
}
