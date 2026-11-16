import { CombinedGraphQLErrors } from '@apollo/client/errors';

/**
 * Extracts a human-readable error message from a GraphQL mutation error.
 *
 * Handles NestJS ValidationPipe errors (array of messages in
 * `extensions.originalError.message`) and standard GraphQL errors.
 */
export function extractGraphQLError(error: unknown, fallback: string): string {
  if (CombinedGraphQLErrors.is(error)) {
    const first = error.errors[0];
    if (!first) return fallback;

    // NestJS ValidationPipe wraps class-validator messages in extensions.originalError
    const original = first.extensions?.originalError as { message?: string | string[] } | undefined;

    if (original?.message) {
      return Array.isArray(original.message) ? original.message.join(', ') : original.message;
    }

    return first.message || fallback;
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
