/**
 * Request limits through the real pipeline (AppModule, real guards, counters in a Redis
 * stand-in that stores what it is given). The limits are set small here; the values in force
 * come from `rateLimitsFrom`. One reverse proxy is declared, so each test picks its own client
 * address with `X-Forwarded-For`.
 */
import { REDIS_CLIENT } from '@roviq/redis';
import {
  createInMemoryRedis,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type GqlResponse,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { RATE_LIMITS, type RateLimits } from '../rate-limit.buckets';

const LIMITS: RateLimits = {
  general: { limit: 12, windowSeconds: 60 },
  user: { limit: 6, windowSeconds: 60 },
  signIn: { limit: 3, windowSeconds: 60 },
  refresh: { limit: 2, windowSeconds: 1 },
  password: { limit: 2, windowSeconds: 60 },
  oneTimeCode: { limit: 2, windowSeconds: 60 },
  passkey: { limit: 2, windowSeconds: 60 },
  impersonation: { limit: 2, windowSeconds: 60 },
  publicLookup: { limit: 2, windowSeconds: 60 },
  webhook: { limit: 2, windowSeconds: 60 },
};

const LOGIN = `mutation ($u: String!) { instituteLogin(username: $u, password: "wrong-password") { accessToken } }`;
const REFRESH = `mutation { refreshToken(token: "not-a-token") { accessToken } }`;
const EDITION = '{ edition }';
const HELP_MODE = '{ myFormHelpMode }';

let nextAddress = 0;
/** A client address no other test uses (TEST-NET-3). */
function freshAddress(): string {
  nextAddress += 1;
  return `203.0.113.${nextAddress}`;
}

describe('request limits (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let other: TestInstitute;

  const tokenOf = (who: TestInstitute): string =>
    createInstituteToken({
      sub: who.userId,
      tenantId: who.tenantId,
      membershipId: who.membershipId,
      roleId: who.roleId,
    });

  async function send(
    address: string,
    query: string,
    options: { variables?: Record<string, unknown>; token?: string } = {},
  ): Promise<GqlResponse> {
    const call = request(result.httpServer)
      .post('/api/graphql')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', address);
    if (options.token) call.set('Authorization', `Bearer ${options.token}`);
    const response = await call.send({ query, variables: options.variables });
    return response.body as GqlResponse;
  }

  const codeOf = (response: GqlResponse): string | undefined =>
    response.errors?.[0]?.extensions?.code;

  /** A username nobody has, different each time, so the per-account lockout never joins in. */
  const stranger = (): Record<string, unknown> => ({ u: `nobody-${crypto.randomUUID()}` });

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: REDIS_CLIENT, useValue: createInMemoryRedis() },
        { provide: RATE_LIMITS, useValue: LIMITS },
      ],
    });
    result.app.getHttpAdapter().getInstance().set('trust proxy', 1);
    institute = await createTestInstitute(result.db);
    other = await createTestInstitute(result.db);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('the sign-in bucket', () => {
    it('should answer normally up to the limit and refuse the next attempt', async () => {
      const address = freshAddress();
      for (let attempt = 1; attempt <= LIMITS.signIn.limit; attempt++) {
        expect(codeOf(await send(address, LOGIN, { variables: stranger() }))).toBe(
          'INVALID_CREDENTIALS',
        );
      }

      const refused = await send(address, LOGIN, { variables: stranger() });

      expect(codeOf(refused)).toBe('TOO_MANY_REQUESTS');
      expect(refused.errors?.[0]?.message).toMatch(
        /^Too many requests\. Try again in \d+ seconds\.$/,
      );
    });

    it('should not let one client use up another client’s attempts', async () => {
      const busy = freshAddress();
      for (let attempt = 0; attempt <= LIMITS.signIn.limit; attempt++) {
        await send(busy, LOGIN, { variables: stranger() });
      }

      const quiet = await send(freshAddress(), LOGIN, { variables: stranger() });

      expect(codeOf(quiet)).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('a strict bucket and aliases', () => {
    it('should count every aliased call of one request against the bucket', async () => {
      const aliases = Array.from(
        { length: LIMITS.publicLookup.limit + 1 },
        (_, index) => `t${index}: verifyTC(token: "${crypto.randomUUID()}") { __typename }`,
      );

      const response = await send(freshAddress(), `{ ${aliases.join(' ')} }`);

      expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
        'TOO_MANY_REQUESTS',
      ]);
      expect(response.data).toEqual({ t0: null, t1: null, t2: null });
    });
  });

  describe('a bucket’s window', () => {
    it('should accept requests again once the window has passed', async () => {
      const address = freshAddress();
      for (let attempt = 0; attempt < LIMITS.refresh.limit; attempt++) {
        expect(codeOf(await send(address, REFRESH))).not.toBe('TOO_MANY_REQUESTS');
      }
      expect(codeOf(await send(address, REFRESH))).toBe('TOO_MANY_REQUESTS');

      // One request after the one-second window: polling would itself fill the address's
      // general bucket and be refused for that instead.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(codeOf(await send(address, REFRESH))).not.toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('the bucket of a signed-in user', () => {
    it('should follow the user across client addresses, and leave another user alone', async () => {
      const token = tokenOf(institute);
      for (let call = 1; call <= LIMITS.user.limit; call++) {
        expect((await send(freshAddress(), HELP_MODE, { token })).errors).toBeUndefined();
      }

      const refused = await send(freshAddress(), HELP_MODE, { token });
      const someoneElse = await send(freshAddress(), HELP_MODE, { token: tokenOf(other) });

      expect(codeOf(refused)).toBe('TOO_MANY_REQUESTS');
      expect(someoneElse.errors).toBeUndefined();
    });
  });

  describe('the bucket of a client address', () => {
    it('should refuse the request after the limit, signed in or not', async () => {
      const address = freshAddress();
      for (let call = 1; call <= LIMITS.general.limit; call++) {
        expect((await send(address, EDITION)).errors).toBeUndefined();
      }

      expect(codeOf(await send(address, EDITION))).toBe('TOO_MANY_REQUESTS');
    });

    it('should count each root field of a request', async () => {
      const address = freshAddress();
      const fields = Array.from({ length: 6 }, (_, index) => `e${index}: edition`).join(' ');

      const first = await send(address, `{ ${fields} }`);
      const second = await send(address, `{ ${fields} }`);
      const third = await send(address, EDITION);

      expect(first.errors).toBeUndefined();
      expect(second.errors).toBeUndefined();
      expect(codeOf(third)).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('the health routes', () => {
    it('should keep answering a client that is over every limit', async () => {
      const address = freshAddress();
      for (let call = 0; call <= LIMITS.general.limit; call++) await send(address, EDITION);
      expect(codeOf(await send(address, EDITION))).toBe('TOO_MANY_REQUESTS');

      const health = await request(result.httpServer)
        .get('/api/health/ready')
        .set('X-Forwarded-For', address);

      // Redis and NATS are stand-ins here, so the answer itself is not the subject: it is not 429.
      expect(health.status).not.toBe(429);
    });
  });

  describe('a REST route', () => {
    it('should be counted and refused with 429', async () => {
      const address = freshAddress();
      const call = () =>
        request(result.httpServer).get('/api/auth/ws-ticket').set('X-Forwarded-For', address);
      for (let attempt = 1; attempt <= LIMITS.general.limit; attempt++) {
        expect((await call()).status).toBe(401);
      }

      const refused = await call();

      expect(refused.status).toBe(429);
    });
  });
});
