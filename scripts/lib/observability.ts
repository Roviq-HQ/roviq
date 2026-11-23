// Pure helpers of the OpenObserve loader (scripts/observability-load.ts).

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when everything `wanted` states is present in `stored`. OpenObserve adds defaults and
 * bookkeeping fields to what it stores, so equality would report a change on every run.
 */
export function isSubset(wanted: Json, stored: Json | undefined): boolean {
  if (Array.isArray(wanted)) {
    return (
      Array.isArray(stored) &&
      stored.length === wanted.length &&
      wanted.every((item, index) => isSubset(item, stored[index]))
    );
  }
  if (isRecord(wanted)) {
    return (
      isRecord(stored) &&
      Object.entries(wanted).every(([key, value]) => isSubset(value, stored[key]))
    );
  }
  return wanted === stored;
}

export type LoadAction = 'created' | 'updated' | 'unchanged';

/** What the loader must do with one object, given what OpenObserve holds under the same name. */
export function planLoad(wanted: Json, stored: Json | undefined): LoadAction {
  if (stored === undefined) return 'created';
  return isSubset(wanted, stored) ? 'unchanged' : 'updated';
}

/** Recipients of alert emails: `OPENOBSERVE_ALERT_EMAILS` (comma-separated), else the loader's own user. */
export function alertRecipients(configured: string | undefined, user: string): string[] {
  const listed = (configured ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
  return listed.length > 0 ? listed : [user];
}
