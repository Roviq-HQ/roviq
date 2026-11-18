import { extractGraphQLErrorCode } from '@roviq/graphql';

const KNOWN_CODES = ['FORBIDDEN', 'UNAUTHENTICATED'] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

/** Maps an Apollo error to an `adminMonitoring.errors.*` key; never surfaces `err.message`. */
export function monitoringErrorKey(error: unknown): `errors.${KnownCode}` | 'errors.loadFailed' {
  const code = extractGraphQLErrorCode(error);
  const known = KNOWN_CODES.find((c) => c === code);
  return known ? `errors.${known}` : 'errors.loadFailed';
}
