import type { AuthUser, LoginInput } from './types';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

async function graphqlFetch<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0].message ?? 'GraphQL error');
  }

  return json.data;
}

export function createAuthMutations(graphqlUrl: string) {
  return {
    async login(input: LoginInput): Promise<AuthResponse> {
      const data = await graphqlFetch<{ login: AuthResponse }>(
        graphqlUrl,
        `mutation Login($username: String!, $password: String!, $tenantId: String!) {
          login(username: $username, password: $password, tenantId: $tenantId) {
            accessToken
            refreshToken
            user { id username email tenantId roleId abilityRules }
          }
        }`,
        { username: input.username, password: input.password, tenantId: input.tenantId },
      );
      return data.login;
    },

    async refresh(refreshToken: string): Promise<AuthResponse> {
      const data = await graphqlFetch<{ refreshToken: AuthResponse }>(
        graphqlUrl,
        `mutation RefreshToken($token: String!) {
          refreshToken(token: $token) {
            accessToken
            refreshToken
            user { id username email tenantId roleId abilityRules }
          }
        }`,
        { token: refreshToken },
      );
      return data.refreshToken;
    },

    async logout(): Promise<void> {
      try {
        await graphqlFetch(graphqlUrl, 'mutation Logout { logout }');
      } catch {
        // Ignore — tokens are cleared client-side regardless
      }
    },
  };
}
