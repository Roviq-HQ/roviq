import type { Locale } from './notification-type';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` as people read it ("22 November 2026", "22 नवंबर 2026"); null when the value is
 * missing or not a real date. Formatted in UTC so a calendar date never shifts a day.
 */
export function formatCalendarDate(
  value: string | null | undefined,
  locale: Locale,
): string | null {
  const match = value ? CALENDAR_DATE.exec(value) : null;
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
