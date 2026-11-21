/**
 * Email verification (SF-045): the code proves the account owner reads the mailbox, and only a
 * verified address may identify an account when a role is granted by email.
 */
import assert from 'node:assert';
import { mkAdminCtx, users, withAdmin } from '@roviq/database';
import type { JetStreamClient } from '@roviq/nats-jetstream';
import type { AuthSecurityEvent } from '@roviq/notifications';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  cleanupTestInstitute,
  createInMemoryRedis,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { EMPTY } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app/app.module';
import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EmailVerificationService,
} from '../email-verification.service';

const STATE = 'query { myEmailVerification { email isVerified } }';
const REQUEST = 'mutation { requestEmailVerification }';
const VERIFY = 'mutation ($code: String!) { verifyEmail(code: $code) }';

describe('Email verification (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let token: string;
  let emitted: AuthSecurityEvent[] = [];

  const call = <T>(query: string, variables?: Record<string, unknown>, as = token) =>
    gqlRequest<T>(result.httpServer, { query, variables, token: as });
  const isVerified = async () =>
    (await call<{ myEmailVerification: { isVerified: boolean } }>(STATE)).data?.myEmailVerification
      .isVerified;
  const setVerified = (at: Date | null) =>
    withAdmin(result.db, mkAdminCtx('test:email-verification'), (tx) =>
      tx.update(users).set({ emailVerifiedAt: at }).where(eq(users.id, institute.userId)),
    );
  /** Asks for a code and returns the one the notification event carries. */
  const requestCode = async () => {
    // A code may be re-sent only after a minute; a fresh pending state keeps tests independent.
    await result.app.get(EmailVerificationService).clearPending(institute.userId);
    const res = await call<{ requestEmailVerification: boolean }>(REQUEST);
    expect(res.errors).toBeUndefined();
    const event = emitted.at(-1);
    assert(event?.metadata.otp);
    return event;
  };

  beforeAll(async () => {
    // What the gateway publishes is read from the NATS client it publishes through.
    const nats = createMock<JetStreamClient>({
      emit: vi.fn((pattern: string, payload: unknown) => {
        if (pattern === 'NOTIFICATION.auth.security') emitted.push(payload as AuthSecurityEvent);
        return EMPTY;
      }),
    });
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: 'JETSTREAM_CLIENT', useValue: nats },
        // The pending code lives in Redis, so the default no-op Redis will not do.
        { provide: REDIS_CLIENT, useValue: createInMemoryRedis() },
      ],
    });
    institute = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
  });

  afterAll(async () => {
    await cleanupTestInstitute(result.db, institute);
    await result?.close();
  });

  beforeEach(async () => {
    emitted = [];
    await setVerified(null);
  });

  it('sends the code to the account email only and verifies the address with it', async () => {
    expect(await isVerified()).toBe(false);

    const event = await requestCode();

    expect(event.eventType).toBe('EMAIL_VERIFICATION');
    expect(event.userId).toBe(institute.userId);
    expect(event.metadata.otp).toMatch(/^\d{6}$/);
    const [user] = await withAdmin(result.db, mkAdminCtx('test:email-verification'), (tx) =>
      tx.select({ email: users.email }).from(users).where(eq(users.id, institute.userId)),
    );
    expect(event.metadata.recipientEmail).toBe(user.email);
    expect(event.metadata.recipientPhone).toBeUndefined();

    const verified = await call<{ verifyEmail: boolean }>(VERIFY, { code: event.metadata.otp });
    expect(verified.errors).toBeUndefined();
    expect(await isVerified()).toBe(true);

    // The code is spent.
    await setVerified(null);
    const again = await call(VERIFY, { code: event.metadata.otp });
    expect(again.errors?.[0]?.extensions?.code).toBe('EMAIL_VERIFICATION_CODE_INVALID');
    expect(await isVerified()).toBe(false);
  });

  it('refuses a wrong code and stops accepting even the right one after too many guesses', async () => {
    const event = await requestCode();
    const right = event.metadata.otp;
    assert(right);
    const wrong = right === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < EMAIL_VERIFICATION_MAX_ATTEMPTS; attempt++) {
      const res = await call(VERIFY, { code: wrong });
      expect(res.errors?.[0]?.extensions?.code).toBe('EMAIL_VERIFICATION_CODE_INVALID');
    }

    const late = await call(VERIFY, { code: right });
    expect(late.errors?.[0]?.extensions?.code).toBe('EMAIL_VERIFICATION_CODE_INVALID');
    expect(await isVerified()).toBe(false);
  });

  it('refuses a second code within a minute and sends nothing for a verified address', async () => {
    await requestCode();
    const tooSoon = await call(REQUEST);
    expect(tooSoon.errors?.[0]?.extensions?.code).toBe('EMAIL_VERIFICATION_TOO_SOON');
    expect(emitted).toHaveLength(1);

    await setVerified(new Date());
    await result.app.get(EmailVerificationService).clearPending(institute.userId);
    const verified = await call<{ requestEmailVerification: boolean }>(REQUEST);
    expect(verified.errors).toBeUndefined();
    expect(emitted).toHaveLength(1);
  });

  it('refuses a code without a pending request, and an anonymous caller', async () => {
    await result.app.get(EmailVerificationService).clearPending(institute.userId);
    const noRequest = await call(VERIFY, { code: '123456' });
    expect(noRequest.errors?.[0]?.extensions?.code).toBe('EMAIL_VERIFICATION_CODE_INVALID');

    const anonymous = await gqlRequest(result.httpServer, { query: REQUEST });
    expect(anonymous.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(emitted).toEqual([]);
  });
});
