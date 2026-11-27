/**
 * ROV-293: every standard operation that takes an id refuses a standard or an academic year of
 * another institute, returns none of its data, and writes nothing in either institute.
 */
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  standards,
  withAdmin,
} from '@roviq/database';
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

const ORIGIN = 'test:standard-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const STANDARD = /* GraphQL */ `
  query Standard($id: ID!) {
    standard(id: $id) {
      id
      name
    }
  }
`;
const STANDARDS = /* GraphQL */ `
  query Standards($academicYearId: ID) {
    standards(academicYearId: $academicYearId) {
      id
    }
  }
`;
const CREATE = /* GraphQL */ `
  mutation CreateStandard($academicYearId: ID!) {
    createStandard(input: { academicYearId: $academicYearId, name: { en: "Class 9" }, numericOrder: 9 }) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateStandard($id: ID!) {
    updateStandard(id: $id, input: { name: { en: "Renamed" } }) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteStandard($id: ID!) {
    deleteStandard(id: $id)
  }
`;

interface Structure {
  yearId: string;
  standardId: string;
}

describe('standard: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Structure;
  let b: Structure;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [instB, b],
    specFile: __filename,
  });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const standardsOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx.select().from(standards).where(eq(standards.tenantId, tenantId)).orderBy(standards.id),
    );

  const standardsInForeignYear = () =>
    asAdmin((tx) =>
      tx
        .select()
        .from(standards)
        .where(eq(standards.academicYearId, b.yearId))
        .orderBy(standards.id),
    );

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Structure> => {
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId: inst.tenantId,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE',
          ...BY,
        })
        .returning({ id: academicYears.id });
      const [standard] = await tx
        .insert(standards)
        .values({
          tenantId: inst.tenantId,
          academicYearId: year.id,
          name: { en: 'Class 5' },
          numericOrder: 5,
          level: 'PRIMARY',
          ...BY,
        })
        .returning({ id: standards.id });
      return { yearId: year.id, standardId: standard.id };
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
    a = await setUp(instA);
    b = await setUp(instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('standard should refuse a standard of another institute and return none of it', async () => {
    const res = await request({
      query: STANDARD,
      variables: { id: b.standardId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STANDARD_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it('standards should list its own year and nothing of another institute year', async () => {
    const own = await request<{ standards: { id: string }[] }>({
      query: STANDARDS,
      variables: { academicYearId: a.yearId },
      token: tokenA,
    });
    const foreign = await request<{ standards: { id: string }[] }>({
      query: STANDARDS,
      variables: { academicYearId: b.yearId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.standards).toEqual([{ id: a.standardId }]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.standards).toEqual([]);
  });

  it('createStandard should create a standard in its own year', async () => {
    const res = await request<{ createStandard: { id: string } }>({
      query: CREATE,
      variables: { academicYearId: a.yearId },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const [row] = await asAdmin((tx) =>
      tx
        .select({ tenantId: standards.tenantId, academicYearId: standards.academicYearId })
        .from(standards)
        .where(eq(standards.id, res.data?.createStandard.id ?? '')),
    );
    expect(row).toEqual({ tenantId: instA.tenantId, academicYearId: a.yearId });
  });

  it('createStandard should refuse an academic year of another institute and write nothing', async () => {
    const ownBefore = await standardsOf(instA.tenantId);
    const otherBefore = await standardsOf(instB.tenantId);
    const inForeignYearBefore = await standardsInForeignYear();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query: CREATE,
      variables: { academicYearId: b.yearId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.ACADEMIC_YEAR_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await standardsInForeignYear()).toEqual(inForeignYearBefore);
    expect(await standardsOf(instB.tenantId)).toEqual(otherBefore);
    expect(await standardsOf(instA.tenantId)).toEqual(ownBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it.each([
    ['updateStandard', UPDATE],
    ['deleteStandard', DELETE],
  ] as const)('%s should refuse a standard of another institute and change neither institute', async (_operation, query) => {
    const ownBefore = await standardsOf(instA.tenantId);
    const otherBefore = await standardsOf(instB.tenantId);
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query,
      variables: { id: b.standardId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STANDARD_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await standardsOf(instB.tenantId)).toEqual(otherBefore);
    expect(await standardsOf(instA.tenantId)).toEqual(ownBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });
});
