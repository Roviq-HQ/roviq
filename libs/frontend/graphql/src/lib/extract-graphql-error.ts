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

/**
 * What `fetch` rejects with when the request never got a response (offline, DNS, refused,
 * CORS), per engine: Chromium, Firefox, Safari, Node. Apollo Client 4 passes it on unwrapped.
 */
const FETCH_FAILURE_MESSAGES = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
  'fetch failed',
];

function isFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TypeError') return false;
  return FETCH_FAILURE_MESSAGES.some((message) => error.message.startsWith(message));
}

/**
 * True when the request failed before a GraphQL response arrived: offline, server down, bad reply.
 * A TypeError from a bug in the app's own code is not one.
 */
export function isNetworkError(error: unknown): boolean {
  return ServerError.is(error) || ServerParseError.is(error) || isFetchFailure(error);
}
