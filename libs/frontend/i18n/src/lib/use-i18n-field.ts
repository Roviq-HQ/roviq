'use client';

import { useLocale } from 'next-intl';
import type { I18nText } from './i18n-text-schema';
import { useInstituteLocales } from './institute-locales';

export function useI18nField() {
  const locale = useLocale();
  const { defaultLocale } = useInstituteLocales();
  return function resolveI18n(field: I18nText | string | null | undefined): string {
    if (!field) return '';
    if (typeof field === 'string') return field; // backwards compat — remove after full i18n migration
    return (
      [field[locale], field[defaultLocale], ...Object.values(field)].find((value) =>
        value?.trim(),
      ) ?? ''
    );
  };
}
