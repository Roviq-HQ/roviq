import type {
  AuthUser,
  LoginInput,
  LoginResult,
  MembershipInfo,
  PasskeyAuthOptions,
  SessionInfo,
} from './types';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const USER_FIELDS = 'id username email scope tenantId resellerId membershipId roleId abilityRules';
const LOGIN_RESULT_FIELDS = `
  accessToken
  refreshToken
  user { ${USER_FIELDS} }
  platformToken
  memberships { tenantId roleId instituteName instituteSlug instituteLogoUrl roleName }
`;

async function graphqlFetch<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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
    // Legacy login — kept for backward compatibility
    async login(input: LoginInput): Promise<LoginResult> {
      const data = await graphqlFetch<{
        login: {
          accessToken?: string;
          refreshToken?: string;
          user?: AuthUser;
          platformToken?: string;
          memberships?: MembershipInfo[];
        };
      }>(
        graphqlUrl,
        `mutation Login($username: String!, $password: String!) {
          login(username: $username, password: $password) {
            ${LOGIN_RESULT_FIELDS}
          }
        }`,
        { username: input.username, password: input.password },
      );
      return data.login;
    },

    // Scope-specific login mutations
    async adminLogin(input: LoginInput): Promise<LoginResult> {
      const data = await graphqlFetch<{ adminLogin: LoginResult }>(
        graphqlUrl,
        `mutation AdminLogin($username: String!, $password: String!) {
          adminLogin(username: $username, password: $password) {
            ${LOGIN_RESULT_FIELDS}
          }
        }`,
        { username: input.username, password: input.password },
      );
      return data.adminLogin;
    },

    async resellerLogin(input: LoginInput): Promise<LoginResult> {
      const data = await graphqlFetch<{ resellerLogin: LoginResult }>(
        graphqlUrl,
        `mutation ResellerLogin($username: String!, $password: String!) {
          resellerLogin(username: $username, password: $password) {
            ${LOGIN_RESULT_FIELDS}
          }
        }`,
        { username: input.username, password: input.password },
      );
      return data.resellerLogin;
    },

    async instituteLogin(input: LoginInput): Promise<LoginResult> {
      const data = await graphqlFetch<{ instituteLogin: LoginResult }>(
        graphqlUrl,
        `mutation InstituteLogin($username: String!, $password: String!) {
          instituteLogin(username: $username, password: $password) {
            ${LOGIN_RESULT_FIELDS}
          }
        }`,
        { username: input.username, password: input.password },
      );
      return data.instituteLogin;
    },

    async selectInstitute(tenantId: string, platformToken: string): Promise<AuthResponse> {
      const data = await graphqlFetch<{ selectInstitute: AuthResponse }>(
        graphqlUrl,
        `mutation SelectInstitute($tenantId: String!) {
          selectInstitute(tenantId: $tenantId) {
            accessToken
            refreshToken
            user { ${USER_FIELDS} }
          }
        }`,
        { tenantId },
        { Authorization: `Bearer ${platformToken}` },
      );
      return data.selectInstitute;
    },

    async switchInstitute(membershipId: string, accessToken: string): Promise<AuthResponse> {
      const data = await graphqlFetch<{ switchInstitute: AuthResponse }>(
        graphqlUrl,
        `mutation SwitchInstitute($membershipId: String!) {
          switchInstitute(membershipId: $membershipId) {
            accessToken
            refreshToken
            user { ${USER_FIELDS} }
          }
        }`,
        { membershipId },
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.switchInstitute;
    },

    async refresh(refreshToken: string): Promise<AuthResponse> {
      const data = await graphqlFetch<{ refreshToken: AuthResponse }>(
        graphqlUrl,
        `mutation RefreshToken($token: String!) {
          refreshToken(token: $token) {
            accessToken
            refreshToken
            user { ${USER_FIELDS} }
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

    // Session management
    async mySessions(accessToken: string): Promise<SessionInfo[]> {
      const data = await graphqlFetch<{ mySessions: SessionInfo[] }>(
        graphqlUrl,
        `query MySessions {
          mySessions {
            id
            ipAddress
            userAgent
            lastActiveAt
            createdAt
            isCurrent
          }
        }`,
        undefined,
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.mySessions;
    },

    async revokeSession(sessionId: string, accessToken: string): Promise<boolean> {
      const data = await graphqlFetch<{ revokeSession: boolean }>(
        graphqlUrl,
        `mutation RevokeSession($sessionId: String!) {
          revokeSession(sessionId: $sessionId)
        }`,
        { sessionId },
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.revokeSession;
    },

    async revokeAllOtherSessions(accessToken: string): Promise<boolean> {
      const data = await graphqlFetch<{ revokeAllOtherSessions: boolean }>(
        graphqlUrl,
        `mutation RevokeAllOtherSessions {
          revokeAllOtherSessions
        }`,
        undefined,
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.revokeAllOtherSessions;
    },

    // Passkey mutations
    async generatePasskeyAuthOptions(): Promise<PasskeyAuthOptions> {
      const data = await graphqlFetch<{ generatePasskeyAuthOptions: PasskeyAuthOptions }>(
        graphqlUrl,
        `mutation GeneratePasskeyAuthOptions {
          generatePasskeyAuthOptions {
            optionsJSON
            challengeId
          }
        }`,
      );
      return data.generatePasskeyAuthOptions;
    },

    async verifyPasskeyAuth(
      challengeId: string,
      credential: Record<string, unknown>,
    ): Promise<LoginResult> {
      const data = await graphqlFetch<{ verifyPasskeyAuth: LoginResult }>(
        graphqlUrl,
        `mutation VerifyPasskeyAuth($input: VerifyPasskeyAuthInput!) {
          verifyPasskeyAuth(input: $input) {
            ${LOGIN_RESULT_FIELDS}
          }
        }`,
        { input: { challengeId, credential } },
      );
      return data.verifyPasskeyAuth;
    },

    async generatePasskeyRegistrationOptions(
      password: string,
      accessToken: string,
    ): Promise<Record<string, unknown>> {
      const data = await graphqlFetch<{
        generatePasskeyRegistrationOptions: Record<string, unknown>;
      }>(
        graphqlUrl,
        `mutation GeneratePasskeyRegistrationOptions($input: GeneratePasskeyRegistrationInput!) {
          generatePasskeyRegistrationOptions(input: $input)
        }`,
        { input: { password } },
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.generatePasskeyRegistrationOptions;
    },

    async verifyPasskeyRegistration(
      credential: Record<string, unknown>,
      name: string | undefined,
      accessToken: string,
    ): Promise<{
      id: string;
      name: string;
      deviceType: string;
      backedUp: boolean;
      registeredAt: string;
    }> {
      const data = await graphqlFetch<{
        verifyPasskeyRegistration: {
          id: string;
          name: string;
          deviceType: string;
          backedUp: boolean;
          registeredAt: string;
        };
      }>(
        graphqlUrl,
        `mutation VerifyPasskeyRegistration($input: VerifyPasskeyRegistrationInput!) {
          verifyPasskeyRegistration(input: $input) {
            id
            name
            deviceType
            backedUp
            registeredAt
          }
        }`,
        { input: { credential, name } },
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.verifyPasskeyRegistration;
    },

    async myPasskeys(accessToken: string): Promise<
      {
        id: string;
        name: string;
        deviceType: string;
        backedUp: boolean;
        registeredAt: string;
        lastUsedAt?: string;
      }[]
    > {
      const data = await graphqlFetch<{
        myPasskeys: {
          id: string;
          name: string;
          deviceType: string;
          backedUp: boolean;
          registeredAt: string;
          lastUsedAt?: string;
        }[];
      }>(
        graphqlUrl,
        `query MyPasskeys {
          myPasskeys {
            id
            name
            deviceType
            backedUp
            registeredAt
            lastUsedAt
          }
        }`,
        undefined,
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.myPasskeys;
    },

    async removePasskey(passkeyId: string, accessToken: string): Promise<boolean> {
      const data = await graphqlFetch<{ removePasskey: boolean }>(
        graphqlUrl,
        `mutation RemovePasskey($passkeyId: String!) {
          removePasskey(passkeyId: $passkeyId)
        }`,
        { passkeyId },
        { Authorization: `Bearer ${accessToken}` },
      );
      return data.removePasskey;
    },
  };
}
