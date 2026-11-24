/**
 * ROV-293: updateAcademicYear refuses an academic year of another institute and changes nothing.
 */
import { academicYears, mkAdminCtx, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('academic year: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let tokenA: string;
  let yearB: string;

  const yearsOf = (tenantId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          id: academicYears.id,
          label: academicYears.label,
          startDate: academicYears.startDate,
          endDate: academicYears.endDate,
          updatedAt: academicYears.updatedAt,
        })
        .from(academicYears)
        .where(eq(academicYears.tenantId, tenantId)),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    const instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    yearB = await withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(academicYears)
        .values({
          tenantId: instB.tenantId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
        })
        .returning({ id: academicYears.id, tenantId: academicYears.tenantId });
      return row.id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should refuse updateAcademicYear on another institute year and change neither institute', async () => {
    const [foreignBefore] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select().from(academicYears).where(eq(academicYears.id, yearB)),
    );
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
    const [foreignAfter] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select().from(academicYears).where(eq(academicYears.id, yearB)),
    );
    expect(foreignAfter).toEqual(foreignBefore);
    expect(await yearsOf(instA.tenantId)).toEqual(ownBefore);
  });
});
