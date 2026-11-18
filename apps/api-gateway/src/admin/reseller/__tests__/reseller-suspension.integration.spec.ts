/**
 * Reseller suspension and deletion (ROV-97) — full resolver pipeline against
 * real PostgreSQL, with a Redis that stores what the guards write.
 *
 * Covers the session side of the issue's verification list: what a suspended
 * reseller's staff can still do with tokens issued before the suspension, and
 * what must keep working for everyone else. State-machine guards (already
 * suspended, grace period, system reseller) are in the e2e lifecycle spec.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { ErrorCode, ResellerStatus } from '@roviq/common-types';
import {
  authEvents,
  impersonationSessions,
  institutes,
  memberships,
  mkAdminCtx,
  refreshTokens,
  resellerMemberships,
  resellers,
  users,
  withAdmin,
} from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createImpersonationToken,
  createInMemoryRedis,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const PASSWORD = 'Suspension-Test-9!';
const DAY_MS = 24 * 60 * 60 * 1000;

const RESELLER_LOGIN = `
  mutation($username: String!, $password: String!) {
    resellerLogin(username: $username, password: $password) { accessToken refreshToken }
  }
`;
const REFRESH = `mutation($token: String!) { refreshToken(token: $token) { accessToken } }`;
const LIST_INSTITUTES = `query { resellerListInstitutes { totalCount } }`;
const MY_INSTITUTE = `query { myInstitute { id } }`;
const SUSPEND = `mutation($id: String!) { adminSuspendReseller(resellerId: $id, reason: "integration test") { id status } }`;
const UNSUSPEND = `mutation($id: String!) { adminUnsuspendReseller(resellerId: $id) { id status } }`;
const DELETE = `mutation($id: String!) { adminDeleteReseller(resellerId: $id) { id status } }`;

describe('Reseller suspension and deletion (integration)', () => {
  let result: IntegrationAppResult;
  const createdResellers: TestReseller[] = [];
  const createdInstitutes: TestInstitute[] = [];

  const platformAdminToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const gql = (query: string, variables?: Record<string, unknown>, token?: string) =>
    gqlRequest(result.httpServer, { query, variables, token });

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:reseller-suspension'), fn);

  /** A reseller whose admin can really log in, plus one institute it owns. */
  async function setUpReseller(): Promise<{ reseller: TestReseller; institute: TestInstitute }> {
    const reseller = await createTestReseller(result.db);
    createdResellers.push(reseller);
    const passwordHash = await hash(PASSWORD);
    await admin((tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, reseller.userId)),
    );
    const institute = await createTestInstitute(result.db, { resellerId: reseller.resellerId });
    createdInstitutes.push(institute);
    return { reseller, institute };
  }

  async function login(reseller: TestReseller) {
    const response = await gql(RESELLER_LOGIN, { username: reseller.username, password: PASSWORD });
    expect(response.errors).toBeUndefined();
    const tokens = response.data?.resellerLogin;
    assert(tokens);
    return tokens as { accessToken: string; refreshToken: string };
  }

  async function suspend(resellerId: string) {
    const response = await gql(SUSPEND, { id: resellerId }, platformAdminToken);
    expect(response.errors).toBeUndefined();
    expect(response.data?.adminSuspendReseller).toEqual({ id: resellerId, status: 'SUSPENDED' });
  }

  async function startImpersonationSession(
    impersonatorId: string,
    impersonatorScope: 'reseller' | 'platform',
    institute: TestInstitute,
  ): Promise<string> {
    const [session] = await admin((tx) =>
      tx
        .insert(impersonationSessions)
        .values({
          impersonatorId,
          impersonatorScope,
          targetUserId: institute.userId,
          targetTenantId: institute.tenantId,
          reason: 'integration test — reseller suspension',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        .returning({ id: impersonationSessions.id }),
    );
    return session.id;
  }

  const impersonationTokenFor = (
    sessionId: string,
    impersonatorId: string,
    institute: TestInstitute,
  ) =>
    createImpersonationToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
      impersonatorId,
      impersonationSessionId: sessionId,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      // The guards read back the markers that suspension writes.
      overrides: [{ provide: REDIS_CLIENT, useValue: createInMemoryRedis() }],
    });
  });

  afterAll(async () => {
    const userIds = [
      ...createdResellers.map((r) => r.userId),
      ...createdInstitutes.map((i) => i.userId),
    ];
    if (userIds.length > 0) {
      await admin(async (tx) => {
        await tx
          .delete(impersonationSessions)
          .where(inArray(impersonationSessions.targetUserId, userIds));
        await tx.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
        await tx.delete(authEvents).where(inArray(authEvents.userId, userIds));
      });
    }
    for (const institute of createdInstitutes) await cleanupTestInstitute(result.db, institute);
    for (const reseller of createdResellers) await cleanupTestReseller(result.db, reseller);
    await result?.close();
  });

  describe('suspension', () => {
    let reseller: TestReseller;
    let institute: TestInstitute;
    let tokens: { accessToken: string; refreshToken: string };
    let otherSessionTokenId: string;
    let resellerSessionId: string;
    let platformSessionId: string;

    beforeAll(async () => {
      ({ reseller, institute } = await setUpReseller());
      tokens = await login(reseller);

      // The same person is also a member of an institute and signed in there: a
      // session the suspension must not touch.
      const [instituteMembership] = await admin((tx) =>
        tx
          .insert(memberships)
          .values({
            userId: reseller.userId,
            tenantId: institute.tenantId,
            roleId: institute.roleId,
            createdBy: reseller.userId,
            updatedBy: reseller.userId,
          })
          .returning({ id: memberships.id }),
      );
      const [other] = await admin((tx) =>
        tx
          .insert(refreshTokens)
          .values({
            userId: reseller.userId,
            tenantId: institute.tenantId,
            membershipId: instituteMembership.id,
            membershipScope: 'institute',
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + DAY_MS),
            createdBy: reseller.userId,
            updatedBy: reseller.userId,
          })
          .returning({ id: refreshTokens.id }),
      );
      otherSessionTokenId = other.id;

      resellerSessionId = await startImpersonationSession(reseller.userId, 'reseller', institute);
      // A platform admin's session in the same institute must survive the suspension.
      platformSessionId = await startImpersonationSession(
        SEED_IDS.USER_ADMIN,
        'platform',
        institute,
      );
    });

    it('lets staff and their impersonation session work while the reseller is active', async () => {
      const list = await gql(LIST_INSTITUTES, undefined, tokens.accessToken);
      expect(list.errors).toBeUndefined();
      expect(list.data?.resellerListInstitutes.totalCount).toBe(1);

      const impersonated = await gql(
        MY_INSTITUTE,
        undefined,
        impersonationTokenFor(resellerSessionId, reseller.userId, institute),
      );
      expect(impersonated.errors).toBeUndefined();
      expect(impersonated.data?.myInstitute.id).toBe(institute.tenantId);
    });

    it('rejects an access token issued before the suspension on the next request', async () => {
      await suspend(reseller.resellerId);

      const list = await gql(LIST_INSTITUTES, undefined, tokens.accessToken);
      expect(list.data ?? null).toBeNull();
      expect(list.errors?.[0]?.extensions?.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('rejects the refresh token and leaves the same person’s other sessions alone', async () => {
      const refresh = await gql(REFRESH, { token: tokens.refreshToken });
      expect(refresh.data ?? null).toBeNull();
      expect(refresh.errors?.[0]?.extensions?.code).toBe(ErrorCode.SESSION_EXPIRED);

      const rows = await admin((tx) =>
        tx
          .select({
            id: refreshTokens.id,
            scope: refreshTokens.membershipScope,
            revokedAt: refreshTokens.revokedAt,
            revokedReason: refreshTokens.revokedReason,
          })
          .from(refreshTokens)
          .where(eq(refreshTokens.userId, reseller.userId)),
      );
      const resellerRow = rows.find((row) => row.scope === 'reseller');
      const otherRow = rows.find((row) => row.id === otherSessionTokenId);
      assert(resellerRow && otherRow);
      expect(resellerRow.revokedAt).toBeInstanceOf(Date);
      expect(resellerRow.revokedReason).toBe('admin_revoked');
      // Presenting the revoked token above must not have cascaded to this one.
      expect(otherRow.revokedAt).toBeNull();
    });

    it('ends impersonation sessions the staff opened as reseller, and no one else’s', async () => {
      const impersonated = await gql(
        MY_INSTITUTE,
        undefined,
        impersonationTokenFor(resellerSessionId, reseller.userId, institute),
      );
      expect(impersonated.data ?? null).toBeNull();
      expect(impersonated.errors?.[0]?.extensions?.code).toBe(ErrorCode.IMPERSONATION_ENDED);

      const sessions = await admin((tx) =>
        tx
          .select({
            id: impersonationSessions.id,
            endedAt: impersonationSessions.endedAt,
            endedReason: impersonationSessions.endedReason,
          })
          .from(impersonationSessions)
          .where(inArray(impersonationSessions.id, [resellerSessionId, platformSessionId])),
      );
      const asReseller = sessions.find((s) => s.id === resellerSessionId);
      const asPlatform = sessions.find((s) => s.id === platformSessionId);
      assert(asReseller && asPlatform);
      expect(asReseller.endedAt).toBeInstanceOf(Date);
      expect(asReseller.endedReason).toBe('revoked');
      expect(asPlatform.endedAt).toBeNull();
    });

    it('refuses a new reseller login without confirming the password', async () => {
      const response = await gql(RESELLER_LOGIN, {
        username: reseller.username,
        password: PASSWORD,
      });
      expect(response.data ?? null).toBeNull();
      expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it('leaves the institutes of the suspended reseller working', async () => {
      const instituteToken = createInstituteToken({
        sub: institute.userId,
        tenantId: institute.tenantId,
        membershipId: institute.membershipId,
        roleId: institute.roleId,
        resellerId: reseller.resellerId,
      });
      const response = await gql(MY_INSTITUTE, undefined, instituteToken);
      expect(response.errors).toBeUndefined();
      expect(response.data?.myInstitute.id).toBe(institute.tenantId);
    });

    it('lets staff sign in and work again once unsuspended', async () => {
      const unsuspend = await gql(UNSUSPEND, { id: reseller.resellerId }, platformAdminToken);
      expect(unsuspend.errors).toBeUndefined();

      const fresh = await login(reseller);
      const list = await gql(LIST_INSTITUTES, undefined, fresh.accessToken);
      expect(list.errors).toBeUndefined();
      expect(list.data?.resellerListInstitutes.totalCount).toBe(1);

      // Sessions revoked by the suspension stay revoked.
      const old = await gql(REFRESH, { token: tokens.refreshToken });
      expect(old.errors?.[0]?.extensions?.code).toBe(ErrorCode.SESSION_EXPIRED);
    });
  });

  describe('deletion', () => {
    let reseller: TestReseller;
    let institute: TestInstitute;

    const backdateSuspension = (days: number) =>
      admin((tx) =>
        tx
          .update(resellers)
          .set({ suspendedAt: new Date(Date.now() - days * DAY_MS) })
          .where(eq(resellers.id, reseller.resellerId)),
      );

    beforeAll(async () => {
      ({ reseller, institute } = await setUpReseller());
      await suspend(reseller.resellerId);
    });

    it('refuses to delete before the 30-day grace period has passed', async () => {
      await backdateSuspension(29);

      const response = await gql(DELETE, { id: reseller.resellerId }, platformAdminToken);
      expect(response.data ?? null).toBeNull();
      expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.GRACE_PERIOD_NOT_ELAPSED);

      const [row] = await admin((tx) =>
        tx
          .select({ resellerId: institutes.resellerId })
          .from(institutes)
          .where(eq(institutes.id, institute.tenantId)),
      );
      expect(row.resellerId).toBe(reseller.resellerId);
    });

    it('moves institutes to Roviq Direct and removes staff memberships after 30 days', async () => {
      await backdateSuspension(31);

      const response = await gql(DELETE, { id: reseller.resellerId }, platformAdminToken);
      expect(response.errors).toBeUndefined();
      expect(response.data?.adminDeleteReseller).toEqual({
        id: reseller.resellerId,
        status: 'DELETED',
      });

      const state = await admin(async (tx) => {
        const [owner] = await tx
          .select({ resellerId: institutes.resellerId })
          .from(institutes)
          .where(eq(institutes.id, institute.tenantId));
        const [record] = await tx
          .select({ status: resellers.status, deletedAt: resellers.deletedAt })
          .from(resellers)
          .where(eq(resellers.id, reseller.resellerId));
        const staff = await tx
          .select({ deletedAt: resellerMemberships.deletedAt })
          .from(resellerMemberships)
          .where(eq(resellerMemberships.resellerId, reseller.resellerId));
        return { owner, record, staff };
      });

      expect(state.owner.resellerId).toBe(RESELLER_DIRECT_ID);
      expect(state.record.status).toBe(ResellerStatus.DELETED);
      expect(state.record.deletedAt).toBeInstanceOf(Date);
      expect(state.staff).toHaveLength(1);
      expect(state.staff[0].deletedAt).toBeInstanceOf(Date);
    });

    it('keeps the institute usable under Roviq Direct', async () => {
      const instituteToken = createInstituteToken({
        sub: institute.userId,
        tenantId: institute.tenantId,
        membershipId: institute.membershipId,
        roleId: institute.roleId,
        resellerId: RESELLER_DIRECT_ID,
      });
      const response = await gql(MY_INSTITUTE, undefined, instituteToken);
      expect(response.errors).toBeUndefined();
      expect(response.data?.myInstitute.id).toBe(institute.tenantId);
    });

    it('refuses the deleted reseller’s staff at login', async () => {
      const response = await gql(RESELLER_LOGIN, {
        username: reseller.username,
        password: PASSWORD,
      });
      expect(response.data ?? null).toBeNull();
      expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });
  });
});
