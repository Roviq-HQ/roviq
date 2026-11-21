/**
 * Only an ACTIVE institute can be logged into or used (SF-042), through the real pipeline:
 * real login, real tokens, real status mutations.
 */
import { hash } from '@node-rs/argon2';
import type { InstituteStatus } from '@roviq/common-types';
import { institutes, mkAdminCtx, users, withAdmin } from '@roviq/database';
import {
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';

const PASSWORD = 'Status-Password-1';
const LOGIN = /* GraphQL */ `
  mutation ($u: String!, $p: String!) {
    instituteLogin(username: $u, password: $p) { accessToken refreshToken }
  }
`;
const REFRESH = /* GraphQL */ `
  mutation ($t: String!) { refreshToken(token: $t) { accessToken } }
`;
const MY_INSTITUTE = 'query { myInstitute { id } }';

describe('Institute status and access (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;

  const setStatus = (status: InstituteStatus) =>
    withAdmin(result.db, mkAdminCtx('test:institute-status'), (tx) =>
      tx.update(institutes).set({ status }).where(eq(institutes.id, institute.tenantId)),
    );

  const login = () =>
    gqlRequest<{ instituteLogin: { accessToken: string; refreshToken: string } }>(
      result.httpServer,
      { query: LOGIN, variables: { u: institute.username, p: PASSWORD } },
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    const passwordHash = await hash(PASSWORD);
    await withAdmin(result.db, mkAdminCtx('test:institute-status'), (tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, institute.userId)),
    );
  });

  afterAll(async () => {
    await result?.close();
  });

  it.each<InstituteStatus>([
    'PENDING_APPROVAL',
    'PENDING',
    'INACTIVE',
    'SUSPENDED',
    'REJECTED',
  ])('refuses login while the institute is %s', async (status) => {
    await setStatus(status);

    const res = await login();

    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_ACTIVE');
    expect(res.data ?? null).toBeNull();
  });

  it('cuts off an open session when the institute stops being active, and restores it after', async () => {
    await setStatus('ACTIVE');
    const session = (await login()).data?.instituteLogin;
    if (!session) throw new Error('login failed');
    const call = () =>
      gqlRequest(result.httpServer, { query: MY_INSTITUTE, token: session.accessToken });
    expect((await call()).errors).toBeUndefined();

    await setStatus('SUSPENDED');

    expect((await call()).errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    const refreshed = await gqlRequest(result.httpServer, {
      query: REFRESH,
      variables: { t: session.refreshToken },
    });
    expect(refreshed.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');

    await setStatus('ACTIVE');
    expect((await call()).errors).toBeUndefined();
  });
});
