/**
 * ROV-293: every academic-year operation that takes an id refuses an academic year of another
 * institute, returns none of its data and changes neither institute.
 */
import { ErrorCode } from '@roviq/common-types';
import {
  type AcademicYearStatus,
  academicYears,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:academic-year-foreign-id';

const UPDATE = /* GraphQL */ `
  mutation UpdateAcademicYear($id: ID!, $input: UpdateAcademicYearInput!) {
    updateAcademicYear(id: $id, input: $input) {
      id
      label
    }
  }
`;
const ACADEMIC_YEAR = /* GraphQL */ `
  query AcademicYear($id: ID!) {
    academicYear(id: $id) {
      id
      label
    }
  }
`;
const ROLLOVER_PREVIEW = /* GraphQL */ `
  query AcademicYearRolloverPreview($id: ID!) {
    academicYearRolloverPreview(academicYearId: $id) {
      movingUp
      staying
    }
  }
`;
const ACTIVATE = /* GraphQL */ `
  mutation ActivateAcademicYear($id: ID!) {
    activateAcademicYear(id: $id) {
      id
      status
    }
  }
`;
const ARCHIVE = /* GraphQL */ `
  mutation ArchiveAcademicYear($id: ID!) {
    archiveAcademicYear(id: $id) {
      id
      status
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteAcademicYear($id: ID!) {
    deleteAcademicYear(id: $id)
  }
`;

describe('academic year: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  /** PLANNING: a year that activateAcademicYear could move to ACTIVE. */
  let yearB: string;
  /** COMPLETING: a year that archiveAcademicYear could move to ARCHIVED. */
  let completingYearB: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const yearsOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx
        .select()
        .from(academicYears)
        .where(eq(academicYears.tenantId, tenantId))
        .orderBy(academicYears.id),
    );

  const insertYear = (
    tenantId: string,
    startYear: number,
    status: AcademicYearStatus,
    isActive: boolean,
  ) =>
    asAdmin(async (tx) => {
      const [row] = await tx
        .insert(academicYears)
        .values({
          tenantId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
          startDate: `${startYear}-04-01`,
          endDate: `${startYear + 1}-03-31`,
          status,
          isActive,
        })
        .returning({ id: academicYears.id });
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
    // The caller's active year: activating another year would move it to COMPLETING.
    await insertYear(instA.tenantId, 2026, 'ACTIVE', true);
    yearB = await insertYear(instB.tenantId, 2026, 'PLANNING', false);
    completingYearB = await insertYear(instB.tenantId, 2025, 'COMPLETING', false);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should refuse updateAcademicYear on another institute year and change neither institute', async () => {
    const foreignBefore = await yearsOf(instB.tenantId);
    const ownBefore = await yearsOf(instA.tenantId);

    const res = await gqlRequest<{ updateAcademicYear: { id: string } }>(result.httpServer, {
      query: UPDATE,
      variables: {
        id: yearB,
        input: { label: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('ACADEMIC_YEAR_NOT_FOUND');
    expect(res.data?.updateAcademicYear ?? null).toBeNull();
    expect(await yearsOf(instB.tenantId)).toEqual(foreignBefore);
    expect(await yearsOf(instA.tenantId)).toEqual(ownBefore);
  });

  it.each([
    ['academicYear', ACADEMIC_YEAR],
    ['academicYearRolloverPreview', ROLLOVER_PREVIEW],
  ] as const)('%s should refuse another institute year and return none of it', async (_operation, query) => {
    const res = await gqlRequest(result.httpServer, {
      query,
      variables: { id: yearB },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.ACADEMIC_YEAR_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['activateAcademicYear', ACTIVATE, () => yearB, ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['archiveAcademicYear', ARCHIVE, () => completingYearB, ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['deleteAcademicYear', DELETE, () => yearB, ErrorCode.NOT_FOUND],
  ] as const)('%s should refuse another institute year and change neither institute', async (_operation, query, pick, code) => {
    const foreignBefore = await yearsOf(instB.tenantId);
    const ownBefore = await yearsOf(instA.tenantId);
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, {
      query,
      variables: { id: pick() },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await yearsOf(instB.tenantId)).toEqual(foreignBefore);
    expect(await yearsOf(instA.tenantId)).toEqual(ownBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });
});
