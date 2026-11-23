/**
 * createApplication against real PostgreSQL + RLS: the stored row, another institute's standard
 * and an academic year that is not active.
 */
import { randomUUID } from 'node:crypto';
import { AdmissionApplicationStatus } from '@roviq/common-types';
import {
  academicYears,
  admissionApplications,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  standards,
  withAdmin,
} from '@roviq/database';
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

const ORIGIN = 'test:application-create';

function addYearWithStandard(db: DrizzleDB, tenantId: string, isActive: boolean) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: isActive ? '2026-27' : '2025-26',
        startDate: isActive ? '2026-04-01' : '2025-04-01',
        endDate: isActive ? '2027-03-31' : '2026-03-31',
        isActive,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: academicYears.id });
    const [standard] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: `Class 1 ${randomUUID().slice(0, 8)}` },
        numericOrder: 1,
        level: 'PRIMARY',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: standards.id });
    return { academicYearId: year.id, standardId: standard.id };
  });
}

function applicationsOf(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
    tx
      .select({
        id: admissionApplications.id,
        standardId: admissionApplications.standardId,
        status: admissionApplications.status,
      })
      .from(admissionApplications)
      .where(eq(admissionApplications.tenantId, tenantId)),
  );
}

const CREATE = `
  mutation Create($input: CreateApplicationInput!) {
    createApplication(input: $input) { id status standardId academicYearId }
  }`;

interface CreateData {
  createApplication: { id: string; status: string; standardId: string; academicYearId: string };
}

describe('createApplication (integration)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let active: { academicYearId: string; standardId: string };
  let inactive: { academicYearId: string; standardId: string };
  let otherActive: { academicYearId: string; standardId: string };

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
    active = await addYearWithStandard(result.db, instA.tenantId, true);
    inactive = await addYearWithStandard(result.db, instA.tenantId, false);
    otherActive = await addYearWithStandard(result.db, instB.tenantId, true);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should store a SUBMITTED application for the active year', async () => {
    const res = await gqlRequest<CreateData>(result.httpServer, {
      query: CREATE,
      variables: { input: { ...active, formData: { studentName: 'Asha' } } },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const created = res.data?.createApplication;
    expect(created?.status).toBe(AdmissionApplicationStatus.SUBMITTED);
    const rows = await applicationsOf(result.db, instA.tenantId);
    expect(rows).toEqual([
      {
        id: created?.id,
        standardId: active.standardId,
        status: AdmissionApplicationStatus.SUBMITTED,
      },
    ]);
  });

  it("should refuse another institute's standard with STANDARD_NOT_FOUND and write nothing", async () => {
    const beforeA = await applicationsOf(result.db, instA.tenantId);
    const beforeB = await applicationsOf(result.db, instB.tenantId);

    const res = await gqlRequest<CreateData>(result.httpServer, {
      query: CREATE,
      variables: {
        input: {
          academicYearId: active.academicYearId,
          standardId: otherActive.standardId,
          formData: { studentName: 'Ravi' },
        },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('STANDARD_NOT_FOUND');
    expect(await applicationsOf(result.db, instA.tenantId)).toEqual(beforeA);
    expect(await applicationsOf(result.db, instB.tenantId)).toEqual(beforeB);
  });

  it('should refuse a year that is not active with ACADEMIC_YEAR_NOT_ACTIVE', async () => {
    const before = await applicationsOf(result.db, instA.tenantId);

    const res = await gqlRequest<CreateData>(result.httpServer, {
      query: CREATE,
      variables: { input: { ...inactive, formData: { studentName: 'Meera' } } },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('ACADEMIC_YEAR_NOT_ACTIVE');
    expect(await applicationsOf(result.db, instA.tenantId)).toEqual(before);
  });
});
