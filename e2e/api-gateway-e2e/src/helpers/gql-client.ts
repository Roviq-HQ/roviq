import type { FormattedExecutionResult } from 'graphql';

const API_URL = process.env.API_URL || 'http://localhost:3000/api/graphql';

// biome-ignore lint/suspicious/noExplicitAny: e2e tests use dynamic GraphQL queries with varying response shapes
export type GqlResult = FormattedExecutionResult<Record<string, any>>;

export async function gql(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<GqlResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<GqlResult>;
}
