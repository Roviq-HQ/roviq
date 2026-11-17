import { z } from 'zod';

export type I18nText = Record<string, string>;

export function buildI18nTextSchema(message: string, instituteDefaultLocale = 'en') {
  const requiredLocales = [...new Set(['en', instituteDefaultLocale])];
  return z
    .record(z.string().min(2).max(5), z.string().max(500))
    .transform((obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(
          ([key, value]) => requiredLocales.includes(key) || value.trim().length > 0,
        ),
      ),
    )
    .superRefine((obj, ctx) => {
      for (const locale of requiredLocales) {
        if (!obj[locale]?.trim()) ctx.addIssue({ code: 'custom', path: [locale], message });
      }
    });
}

export const i18nTextSchema = buildI18nTextSchema('Required');

export function buildI18nTextOptionalSchema(instituteDefaultLocale = 'en') {
  return z
    .record(z.string().min(2).max(5), z.string().max(500).or(z.undefined()))
    .optional()
    .transform((obj) => {
      if (!obj) return undefined;
      const entries = Object.entries(obj).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0,
      );
      return entries.length ? Object.fromEntries(entries) : undefined;
    })
    .pipe(buildI18nTextSchema('Required', instituteDefaultLocale).optional());
}

export const i18nTextOptionalSchema = buildI18nTextOptionalSchema();
