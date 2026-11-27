/**
 * ROV-293: resellerSuspendInstitute and resellerReactivateInstitute refuse an institute of
 * another reseller and a platform-owned one, and change neither.
 */
import assert from 'node:assert/strict';
import { ErrorCode } from '@roviq/common-types';
import { type DrizzleDB, institutes, mkAdminCtx, withAdmin } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:reseller-institute-foreign-id';

const SUSPEND = /* GraphQL */ `
  mutation Suspend($id: ID!) {
    resellerSuspendInstitute(id: $id, reason: "Fees unpaid") {
      id
      status
    }
  }
`;
const REACTIVATE = /* GraphQL */ `
  mutation Reactivate($id: ID!) {
    resellerReactivateInstitute(id: $id) {
      id
      status
    }
  }
`;

type Status = 'ACTIVE' | 'SUSPENDED';

describe('reseller institute status: another reseller or the platform (ROV-293)', () => {
  let result: IntegrationAppResult;
  let resellerOwn: TestReseller;
  let resellerOther: TestReseller;
  let own: TestInstitute;
  let otherResellers: TestInstitute;
  let platformOwned: TestInstitute;
  let token: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [resellerOther, otherResellers, platformOwned],
    specFile: __filename,
  });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const setStatus = (ids: string[], status: Status) =>
    asAdmin((tx) => tx.update(institutes).set({ status }).where(inArray(institutes.id, ids)));

  const instituteRow = async (id: string) => {
    const [row] = await asAdmin((tx) => tx.select().from(institutes).where(eq(institutes.id, id)));
    assert(row);
    return row;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    resellerOwn = await createTestReseller(result.db);
    resellerOther = await createTestReseller(result.db);
    own = await createTestInstitute(result.db, { resellerId: resellerOwn.resellerId });
    otherResellers = await createTestInstitute(result.db, { resellerId: resellerOther.resellerId });
    platformOwned = await createTestInstitute(result.db);
    token = createResellerToken({
      sub: resellerOwn.userId,
      resellerId: resellerOwn.resellerId,
      membershipId: resellerOwn.membershipId,
      roleId: resellerOwn.roleId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  const cases = [
    ['resellerSuspendInstitute', SUSPEND, 'ACTIVE'],
    ['resellerReactivateInstitute', REACTIVATE, 'SUSPENDED'],
  ] as const;

  it.each(cases)('%s should change its own institute', async (operation, query, from) => {
    await setStatus([own.tenantId], from);

    const res = await request<Record<string, { id: string; status: string }>>({
      query,
      variables: { id: own.tenantId },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.[operation]?.status).toBe(from === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  });

  describe.each(cases)('%s', (_operation, query, from) => {
    it.each([
      ['an institute of another reseller', () => otherResellers.tenantId],
      ['a platform-owned institute', () => platformOwned.tenantId],
    ])('should refuse %s and change no institute', async (_label, pick) => {
      const id = pick();
      await setStatus([id, own.tenantId], from);
      const before = { foreign: await instituteRow(id), own: await instituteRow(own.tenantId) };
      const emit = vi.spyOn(EventBusService.prototype, 'emit');

      const res = await request({ query, variables: { id }, token });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.INSTITUTE_NOT_FOUND);
      expect(res.data).toBeNull();
      expect(await instituteRow(id)).toEqual(before.foreign);
      expect(await instituteRow(own.tenantId)).toEqual(before.own);
      expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    });
  });
});
