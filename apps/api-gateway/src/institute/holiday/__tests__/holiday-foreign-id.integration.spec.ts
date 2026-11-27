/**
 * ROV-293: holiday, updateHoliday and deleteHoliday refuse a holiday of another institute,
 * return none of its data and change neither institute.
 */
import { ErrorCode } from '@roviq/common-types';
import { type DrizzleDB, holidays, mkAdminCtx, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:holiday-foreign-id';

const HOLIDAY = /* GraphQL */ `
  query Holiday($id: ID!) {
    holiday(id: $id) {
      id
      name
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateHoliday($id: ID!) {
    updateHoliday(id: $id, input: { name: { en: "Renamed" }, endDate: "2026-11-03" }) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteHoliday($id: ID!) {
    deleteHoliday(id: $id)
  }
`;

describe('holiday: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let holidayB: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [holidayB],
    specFile: __filename,
  });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const holidaysOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx.select().from(holidays).where(eq(holidays.tenantId, tenantId)).orderBy(holidays.id),
    );

  const insertHoliday = (tenantId: string) =>
    asAdmin(async (tx) => {
      const [row] = await tx
        .insert(holidays)
        .values({
          tenantId,
          name: { en: 'Diwali' },
          type: 'RELIGIOUS',
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: holidays.id });
      return row.id;
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    await insertHoliday(instA.tenantId);
    holidayB = await insertHoliday(instB.tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('holiday should refuse a holiday of another institute and return none of it', async () => {
    const res = await request({
      query: HOLIDAY,
      variables: { id: holidayB },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.HOLIDAY_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['updateHoliday', UPDATE, ErrorCode.HOLIDAY_NOT_FOUND],
    ['deleteHoliday', DELETE, ErrorCode.NOT_FOUND],
  ] as const)('%s should refuse a holiday of another institute and change neither institute', async (_operation, query, code) => {
    const foreignBefore = await holidaysOf(instB.tenantId);
    const ownBefore = await holidaysOf(instA.tenantId);
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query,
      variables: { id: holidayB },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await holidaysOf(instB.tenantId)).toEqual(foreignBefore);
    expect(await holidaysOf(instA.tenantId)).toEqual(ownBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });
});
