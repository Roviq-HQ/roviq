import { CombinedGraphQLErrors, ServerError, ServerParseError } from '@apollo/client/errors';

/**
 * Extracts the server's message from a GraphQL error (validator messages arrive joined).
 * Developer-facing detail only: users see translated copy chosen by `extractGraphQLErrorCode`.
 */
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

/** True when the request failed before a GraphQL response arrived: offline, server down, bad reply. */
export function isNetworkError(error: unknown): boolean {
  return ServerError.is(error) || ServerParseError.is(error) || error instanceof TypeError;
}
