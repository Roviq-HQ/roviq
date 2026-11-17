import { CombinedGraphQLErrors } from '@apollo/client/errors';

/** Extracts the server's message from a GraphQL error (validator messages arrive joined). */
export function extractGraphQLError(error: unknown, fallback: string): string {
  if (CombinedGraphQLErrors.is(error)) {
    return error.errors[0]?.message || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

/** Returns the `extensions.code` of the first GraphQL error, for mapping to translated copy. */
export function extractGraphQLErrorCode(error: unknown): string | null {
  if (!CombinedGraphQLErrors.is(error)) return null;
  const code = error.errors[0]?.extensions?.code;
  return typeof code === 'string' ? code : null;
}
