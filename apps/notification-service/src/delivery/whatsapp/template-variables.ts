import type { Locale } from '../../types/notification-type';
import { cleanVariable } from './whatsapp-template';

const MAX_LISTED_NAMES = 3;
const MAX_NAME_LENGTH = 50;

/** A portal path as the template button takes it: `/institute/attendance` → `institute/attendance`. */
export function buttonPathOf(path: string): string {
  return path.replace(/^\/+/, '');
}

/** Free text an author typed; kept short so the whole message stays within the provider's limit. */
export function clipVariable(
  value: string | null | undefined,
  max: number,
  fallback: string,
): string {
  const cleaned = cleanVariable(value ?? '', fallback);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

/** "Aarav, Diya, Kabir and 2 more": the first few distinct names, the rest as a count. */
export function nameList(
  names: readonly (string | null)[],
  fallback: string,
  locale: Locale,
): string {
  const distinct = [
    ...new Set(
      names.map((name) => clipVariable(name, MAX_NAME_LENGTH, '')).filter((name) => name !== ''),
    ),
  ];
  if (distinct.length === 0) return fallback;
  const listed = distinct.slice(0, MAX_LISTED_NAMES).join(', ');
  const rest = distinct.length - MAX_LISTED_NAMES;
  if (rest <= 0) return listed;
  return locale === 'hi' ? `${listed} और ${rest} अन्य` : `${listed} and ${rest} more`;
}
