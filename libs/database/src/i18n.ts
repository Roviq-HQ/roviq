import { type SQLWrapper, sql } from 'drizzle-orm';

/** Extract display string from i18n JSONB — prefers 'en', falls back to first locale */
export function i18nDisplay(value: Record<string, string> | null | undefined): string {
  if (!value) return '';
  const keys = Object.keys(value);
  if (keys.length === 0) return '';
  return value[keys.includes('en') ? 'en' : keys[0]];
}

export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, '\\$&');
}

export function i18nNameSearch(column: SQLWrapper, query: string) {
  return sql`i18n_text_to_string(${column}) ILIKE ${`%${escapeLikePattern(query.trim())}%`}`;
}

export function i18nLocaleEquals(column: SQLWrapper, locale: string, value: string) {
  return sql`${column} @> ${JSON.stringify({ [locale]: value })}::jsonb`;
}
