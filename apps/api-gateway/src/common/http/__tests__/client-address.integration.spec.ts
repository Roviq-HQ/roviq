/**
 * Which address the API records for a client, with and without a reverse proxy declared
 * (`TRUST_PROXY_HOPS`). Read back through `mySessions` and from the stored session row.
 */

import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from '@node-rs/argon2';
import { mkAdminCtx, refreshTokens, users, withAdmin } from '@roviq/database';
import {
  createIntegrationApp,
  createTestInstitute,
  type GqlResponse,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { applyTrustProxy } from '../trust-proxy';

const PASSWORD = 'Client-Address-1';
const LOGIN = `mutation ($u: String!, $p: String!) {
  instituteLogin(username: $u, password: $p) { accessToken refreshToken }
}`;
const SESSIONS = `query ($t: String!) { mySessions(currentRefreshToken: $t) { ipAddress isCurrent } }`;

/** What the proxy writes: whatever the client sent, then the address the proxy saw. */
const PROXY_SAW = '198.51.100.23';
const CLIENT_CLAIMS = '10.1.2.3';

async function bootWith(hops: string | undefined): Promise<IntegrationAppResult> {
  const result = await createIntegrationApp({ modules: [AppModule] });
  const app = result.app as NestExpressApplication;
  applyTrustProxy(app, new ConfigService(hops === undefined ? {} : { TRUST_PROXY_HOPS: hops }));
  return result;
}

describe('the recorded client address (integration)', () => {
  let direct: IntegrationAppResult;
  let behindProxy: IntegrationAppResult;
  let institute: TestInstitute;

  async function signIn(result: IntegrationAppResult, forwardedFor?: string) {
    const call = request(result.httpServer)
      .post('/api/graphql')
      .set('Content-Type', 'application/json');
    if (forwardedFor) call.set('X-Forwarded-For', forwardedFor);
    const response = await call.send({
      query: LOGIN,
      variables: { u: institute.username, p: PASSWORD },
    });
    const body = response.body as GqlResponse<{
      instituteLogin: { accessToken: string; refreshToken: string };
    }>;
    expect(body.errors).toBeUndefined();
    const tokens = body.data?.instituteLogin;
    if (!tokens?.accessToken || !tokens.refreshToken) throw new Error('sign-in gave no tokens');
    return tokens;
  }

  async function currentSessionAddress(
    result: IntegrationAppResult,
    tokens: { accessToken: string; refreshToken: string },
  ): Promise<string | null | undefined> {
    const response = await request(result.httpServer)
      .post('/api/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ query: SESSIONS, variables: { t: tokens.refreshToken } });
    const body = response.body as GqlResponse<{
      mySessions: { ipAddress: string | null; isCurrent: boolean }[];
    }>;
    expect(body.errors).toBeUndefined();
    return body.data?.mySessions.find((session) => session.isCurrent)?.ipAddress;
  }

  async function latestStoredAddress(result: IntegrationAppResult): Promise<string | null> {
    const [row] = await withAdmin(result.db, mkAdminCtx('test:client-address'), (tx) =>
      tx
        .select({ ipAddress: refreshTokens.ipAddress })
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, institute.userId))
        .orderBy(desc(refreshTokens.createdAt))
        .limit(1),
    );
    return row?.ipAddress ?? null;
  }

  beforeAll(async () => {
    direct = await bootWith(undefined);
    behindProxy = await bootWith('1');
    institute = await createTestInstitute(direct.db);
    const passwordHash = await hash(PASSWORD);
    await withAdmin(direct.db, mkAdminCtx('test:client-address'), (tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, institute.userId)),
    );
  });

  afterAll(async () => {
    await direct?.close();
    await behindProxy?.close();
  });

  describe('with one reverse proxy declared', () => {
    it('should record the address the proxy saw', async () => {
      const tokens = await signIn(behindProxy, PROXY_SAW);

      expect(await currentSessionAddress(behindProxy, tokens)).toBe(PROXY_SAW);
      expect(await latestStoredAddress(behindProxy)).toBe(PROXY_SAW);
    });

    it('should not believe an address the client wrote into the header itself', async () => {
      const tokens = await signIn(behindProxy, `${CLIENT_CLAIMS}, ${PROXY_SAW}`);

      expect(await currentSessionAddress(behindProxy, tokens)).toBe(PROXY_SAW);
      expect(await latestStoredAddress(behindProxy)).toBe(PROXY_SAW);
    });
  });

  describe('with no reverse proxy declared', () => {
    it('should record the address of the connection and ignore the header', async () => {
      const tokens = await signIn(direct, PROXY_SAW);

      const recorded = await currentSessionAddress(direct, tokens);

      expect(recorded).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
      expect(await latestStoredAddress(direct)).toBe(recorded);
    });
  });
});
