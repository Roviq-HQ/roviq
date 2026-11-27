/**
 * Form help mode (ROV-344): saved per account, written only by its owner, refused while
 * impersonating, and unreadable by the institute and reseller roles.
 */
import assert from 'node:assert';
import {
  impersonationSessions,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  users,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createImpersonationToken,
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';

const READ = 'query { myFormHelpMode }';
const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_ENUM_VALUE = '22P02';
const WRITE = 'mutation($mode: FormHelpMode!) { updateMyFormHelpMode(mode: $mode) }';

describe('Form help mode (integration)', () => {
  let result: IntegrationAppResult;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let reseller: TestReseller;
  const sessionIds: string[] = [];

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:form-help-mode'), fn);

  const storedMode = async (userId: string) => {
    const [row] = await admin((tx) =>
      tx
        .select({ mode: users.formHelpMode })
        .from(users) // allow-base-read: form_help_mode is not on users_live
        .where(eq(users.id, userId)),
    );
    return row?.mode;
  };

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instituteA = await createTestInstitute(result.db);
    instituteB = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);
  });

  afterAll(async () => {
    if (result) {
      if (sessionIds.length > 0) {
        await admin((tx) =>
          tx.delete(impersonationSessions).where(inArray(impersonationSessions.id, sessionIds)),
        );
      }
      if (instituteA) await cleanupTestInstitute(result.db, instituteA);
      if (instituteB) await cleanupTestInstitute(result.db, instituteB);
      if (reseller) await cleanupTestReseller(result.db, reseller);
    }
    await result?.close();
  });

  it('starts at the default and saves only the caller’s own account', async () => {
    const token = tokenFor(instituteA);
    const before = await gqlRequest<{ myFormHelpMode: string }>(result.httpServer, {
      query: READ,
      token,
    });
    expect(before.errors).toBeUndefined();
    expect(before.data?.myFormHelpMode).toBe('ICON_AND_HINT');

    const saved = await gqlRequest<{ updateMyFormHelpMode: string }>(result.httpServer, {
      query: WRITE,
      variables: { mode: 'ICON_ONLY' },
      token,
    });
    expect(saved.errors).toBeUndefined();
    expect(saved.data?.updateMyFormHelpMode).toBe('ICON_ONLY');

    expect(await storedMode(instituteA.userId)).toBe('ICON_ONLY');
    expect(await storedMode(instituteB.userId)).toBe('ICON_AND_HINT');
    const after = await gqlRequest<{ myFormHelpMode: string }>(result.httpServer, {
      query: READ,
      token,
    });
    expect(after.data?.myFormHelpMode).toBe('ICON_ONLY');
  });

  it('saves for a reseller account too', async () => {
    const token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
    const saved = await gqlRequest(result.httpServer, {
      query: WRITE,
      variables: { mode: 'ICON_ONLY' },
      token,
    });
    expect(saved.errors).toBeUndefined();
    expect(await storedMode(reseller.userId)).toBe('ICON_ONLY');
  });

  it('refuses a value outside the enum at the API', async () => {
    await expect(
      gqlRequest(result.httpServer, {
        query: WRITE,
        variables: { mode: 'EVERYTHING' },
        token: tokenFor(instituteB),
      }),
    ).rejects.toThrow(/HTTP 400.*does not exist in .{1,2}FormHelpMode/);
    expect(await storedMode(instituteB.userId)).toBe('ICON_AND_HINT');
  });

  describe('while impersonating', () => {
    let impersonationToken: string;

    beforeAll(async () => {
      const [session] = await admin((tx) =>
        tx
          .insert(impersonationSessions)
          .values({
            impersonatorId: SEED_IDS.USER_ADMIN,
            impersonatorScope: 'platform',
            targetUserId: instituteA.userId,
            targetTenantId: instituteA.tenantId,
            reason: 'integration test — form help mode',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          })
          .returning({ id: impersonationSessions.id }),
      );
      assert(session);
      sessionIds.push(session.id);
      impersonationToken = createImpersonationToken({
        sub: instituteA.userId,
        tenantId: instituteA.tenantId,
        membershipId: instituteA.membershipId,
        roleId: instituteA.roleId,
        impersonatorId: SEED_IDS.USER_ADMIN,
        impersonationSessionId: session.id,
      });
    });

    it('reads the default, not the impersonated account’s choice', async () => {
      expect(await storedMode(instituteA.userId)).toBe('ICON_ONLY');
      const res = await gqlRequest<{ myFormHelpMode: string }>(result.httpServer, {
        query: READ,
        token: impersonationToken,
      });
      expect(res.errors).toBeUndefined();
      expect(res.data?.myFormHelpMode).toBe('ICON_AND_HINT');
    });

    it('refuses the write and changes nothing', async () => {
      const res = await gqlRequest(result.httpServer, {
        query: WRITE,
        variables: { mode: 'ICON_AND_HINT' },
        token: impersonationToken,
      });
      expect(res.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_OWN_ACCOUNT');
      expect(await storedMode(instituteA.userId)).toBe('ICON_ONLY');
    });
  });

  describe('in PostgreSQL', () => {
    it('refuses a value outside the enum', async () => {
      await expect(
        admin((tx) =>
          tx.execute(
            sql`UPDATE users SET form_help_mode = 'EVERYTHING' WHERE id = ${instituteB.userId}`,
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: INVALID_ENUM_VALUE } });
      expect(await storedMode(instituteB.userId)).toBe('ICON_AND_HINT');
    });

    it('does not let the institute role read the column', async () => {
      await expect(
        withTenant(result.db, mkInstituteCtx(instituteA.tenantId, 'test:form-help-mode'), (tx) =>
          tx
            .select({ mode: users.formHelpMode })
            .from(users) // allow-base-read: proving the column grant refuses this read
            .where(eq(users.id, instituteA.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: INSUFFICIENT_PRIVILEGE } });
    });

    it('does not let the reseller role read the column', async () => {
      await expect(
        withReseller(result.db, mkResellerCtx(reseller.resellerId, 'test:form-help-mode'), (tx) =>
          tx
            .select({ mode: users.formHelpMode })
            .from(users) // allow-base-read: proving the column grant refuses this read
            .where(eq(users.id, reseller.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: INSUFFICIENT_PRIVILEGE } });
    });
  });
});
