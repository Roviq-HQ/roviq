import type { GraphQLFormattedError } from 'graphql';

/**
 * Format a `GraphQLFormattedError` for test failure output and Console
 * Guardian reports: `<message> [<extensions.code>]`, or `[NO_CODE]` when the
 * error carries no code.
 */
export function formatGraphQLError(err: GraphQLFormattedError): string {
  const code = typeof err.extensions?.code === 'string' ? err.extensions.code : 'NO_CODE';
  return `${err.message ?? ''} [${code}]`;
}
