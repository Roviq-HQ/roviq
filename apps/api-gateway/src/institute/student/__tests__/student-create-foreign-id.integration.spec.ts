/**
 * ROV-293: createStudent refuses an academic year, class or section of another institute and
 * writes nothing in either institute.
 */
import assert from 'node:assert/strict';
import { DefaultRoles, ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tenantUserProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:student-create-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE_STUDENT = /* GraphQL */ `
  mutation CreateStudent($input: CreateStudentInput!) {
    createStudent(input: $input) {
      id
    }
  }
`;

interface Placement {
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

async function setUpInstitute(db: DrizzleDB): Promise<{ base: TestInstitute; place: Placement }> {
  const base = await createTestInstitute(db);
  const place = await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    await tx.insert(roles).values({
      name: { en: DefaultRoles.Student },
      scope: 'institute',
      tenantId: base.tenantId,
      abilities: [],
      isDefault: false,
      isSystem: false,
      ...BY,
    });
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId: base.tenantId,
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
        tenantId: base.tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        ...BY,
      })
      .returning({ id: standards.id });
    const [section] = await tx
      .insert(sections)
      .values({
        tenantId: base.tenantId,
        standardId: standard.id,
        academicYearId: year.id,
        name: { en: 'A' },
        displayLabel: 'Class 5-A',
        capacity: 40,
        ...BY,
      })
      .returning({ id: sections.id });
    return { academicYearId: year.id, standardId: standard.id, sectionId: section.id };
  });
  return { base, place };
}

describe('createStudent: ids of another institute (ROV-293)', () => {
  let result: IntegrationAppResult;
  let a: { base: TestInstitute; place: Placement };
  let b: { base: TestInstitute; place: Placement };
  let tokenA: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [b],
    specFile: __filename,
  });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Everything a student create writes in an institute, and the users the caller created. */
  const writtenIn = (inst: TestInstitute) =>
    asAdmin(async (tx) => ({
      users: await tx.select({ id: users.id }).from(users).where(eq(users.createdBy, inst.userId)),
      memberships: await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.tenantId, inst.tenantId)),
      copies: await tx
        .select({ id: tenantUserProfiles.id })
        .from(tenantUserProfiles)
        .where(eq(tenantUserProfiles.tenantId, inst.tenantId)),
      profiles: await tx
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(eq(studentProfiles.tenantId, inst.tenantId)),
      academics: await tx
        .select({ id: studentAcademics.id })
        .from(studentAcademics)
        .where(eq(studentAcademics.tenantId, inst.tenantId)),
    }));

  /** The other institute's year, class and section rows, and any record that points at them. */
  const foreignRows = () =>
    asAdmin(async (tx) => ({
      year: await tx
        .select()
        .from(academicYears)
        .where(eq(academicYears.id, b.place.academicYearId)),
      standard: await tx.select().from(standards).where(eq(standards.id, b.place.standardId)),
      section: await tx.select().from(sections).where(eq(sections.id, b.place.sectionId)),
      pointing: await tx
        .select({ id: studentAcademics.id })
        .from(studentAcademics)
        .where(
          or(
            eq(studentAcademics.academicYearId, b.place.academicYearId),
            eq(studentAcademics.standardId, b.place.standardId),
            eq(studentAcademics.sectionId, b.place.sectionId),
          ),
        ),
    }));

  const create = (place: Placement) =>
    request<{ createStudent: { id: string } }>({
      query: CREATE_STUDENT,
      variables: { input: { firstName: { en: 'Aarav' }, lastName: { en: 'Mehta' }, ...place } },
      token: tokenA,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    a = await setUpInstitute(result.db);
    b = await setUpInstitute(result.db);
    tokenA = createInstituteToken({
      sub: a.base.userId,
      tenantId: a.base.tenantId,
      membershipId: a.base.membershipId,
      roleId: a.base.roleId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should create a student with its own year, class and section', async () => {
    const res = await create(a.place);

    expect(res.errors).toBeUndefined();
    assert(res.data);
    const [academic] = await asAdmin((tx) =>
      tx
        .select({
          academicYearId: studentAcademics.academicYearId,
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
        })
        .from(studentAcademics)
        .where(eq(studentAcademics.studentProfileId, res.data?.createStudent.id ?? '')),
    );
    expect(academic).toEqual(a.place);
  });

  it.each([
    ['academicYearId', ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['standardId', ErrorCode.STANDARD_NOT_FOUND],
    ['sectionId', ErrorCode.SECTION_NOT_FOUND],
  ] as const)('should refuse %s of another institute and write nothing in either institute', async (field, code) => {
    const ownBefore = await writtenIn(a.base);
    const otherBefore = await writtenIn(b.base);
    const foreignBefore = await foreignRows();

    const res = await create({ ...a.place, [field]: b.place[field] });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await foreignRows()).toEqual(foreignBefore);
    expect(await writtenIn(b.base)).toEqual(otherBefore);
    expect(await writtenIn(a.base)).toEqual(ownBefore);
  });
});
