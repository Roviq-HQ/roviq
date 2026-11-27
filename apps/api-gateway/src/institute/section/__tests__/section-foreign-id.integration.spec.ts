/**
 * ROV-293: every section operation that takes an id refuses a section, standard, academic year
 * or class teacher of another institute, returns none of its data, and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
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
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:section-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const SECTION = /* GraphQL */ `
  query Section($id: ID!) {
    section(id: $id) {
      id
      name
    }
  }
`;
const SECTIONS = /* GraphQL */ `
  query Sections($standardId: ID!) {
    sections(standardId: $standardId) {
      id
    }
  }
`;
const SECTIONS_BY_YEAR = /* GraphQL */ `
  query SectionsByAcademicYear($academicYearId: ID) {
    sectionsByAcademicYear(academicYearId: $academicYearId) {
      id
    }
  }
`;
const CREATE = /* GraphQL */ `
  mutation CreateSection($input: CreateSectionInput!) {
    createSection(input: $input) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateSection($id: ID!, $input: UpdateSectionInput!) {
    updateSection(id: $id, input: $input) {
      id
    }
  }
`;
const ASSIGN_TEACHER = /* GraphQL */ `
  mutation AssignClassTeacher($sectionId: ID!, $classTeacherId: ID!) {
    assignClassTeacher(sectionId: $sectionId, classTeacherId: $classTeacherId) {
      id
      classTeacherId
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteSection($id: ID!) {
    deleteSection(id: $id)
  }
`;

interface Structure {
  yearId: string;
  standardId: string;
  sectionId: string;
  /** A staff membership of the institute, the class-teacher candidate. */
  teacherId: string;
}

describe('section: another institute id (ROV-293)', () => {
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

  const sectionsOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx.select().from(sections).where(eq(sections.tenantId, tenantId)).orderBy(sections.id),
    );

  /** Every section in any institute that points at the other institute's rows. */
  const pointingAtForeign = () =>
    asAdmin((tx) =>
      tx
        .select()
        .from(sections)
        .where(
          or(
            eq(sections.academicYearId, b.yearId),
            eq(sections.standardId, b.standardId),
            eq(sections.classTeacherId, b.teacherId),
          ),
        )
        .orderBy(sections.id),
    );

  const snapshot = async () => ({
    own: await sectionsOf(instA.tenantId),
    other: await sectionsOf(instB.tenantId),
    pointing: await pointingAtForeign(),
  });

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
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId: inst.tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      return {
        yearId: year.id,
        standardId: standard.id,
        sectionId: section.id,
        teacherId: inst.membershipId,
      };
    });

  const sectionInput = (ids: {
    standardId: string;
    academicYearId: string;
    classTeacherId: string;
  }) => ({
    ...ids,
    name: { en: `S-${randomUUID().slice(0, 8)}` },
    displayLabel: '5-S',
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

  it('section should refuse a section of another institute and return none of it', async () => {
    const res = await request({
      query: SECTION,
      variables: { id: b.sectionId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.SECTION_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['sections', SECTIONS, 'standardId', 'standardId'],
    ['sectionsByAcademicYear', SECTIONS_BY_YEAR, 'academicYearId', 'yearId'],
  ] as const)('%s should list its own section and nothing of another institute', async (operation, query, variable, key) => {
    const own = await request<Record<string, { id: string }[]>>({
      query,
      variables: { [variable]: a[key] },
      token: tokenA,
    });
    const foreign = await request<Record<string, { id: string }[]>>({
      query,
      variables: { [variable]: b[key] },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.[operation]).toEqual([{ id: a.sectionId }]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.[operation]).toEqual([]);
  });

  it('createSection should create a section with its own class, year and class teacher', async () => {
    const res = await request<{ createSection: { id: string } }>({
      query: CREATE,
      variables: {
        input: sectionInput({
          standardId: a.standardId,
          academicYearId: a.yearId,
          classTeacherId: a.teacherId,
        }),
      },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const [row] = await asAdmin((tx) =>
      tx
        .select({
          tenantId: sections.tenantId,
          standardId: sections.standardId,
          academicYearId: sections.academicYearId,
        })
        .from(sections)
        .where(eq(sections.id, res.data?.createSection.id ?? '')),
    );
    expect(row).toEqual({
      tenantId: instA.tenantId,
      standardId: a.standardId,
      academicYearId: a.yearId,
    });
  });

  it.each([
    ['standardId', ErrorCode.STANDARD_NOT_FOUND],
    ['academicYearId', ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['classTeacherId', ErrorCode.MEMBERSHIP_NOT_FOUND],
  ] as const)('createSection should refuse %s of another institute and store no reference to it', async (field, code) => {
    const own = { standardId: a.standardId, academicYearId: a.yearId, classTeacherId: a.teacherId };
    const foreign = {
      standardId: b.standardId,
      academicYearId: b.yearId,
      classTeacherId: b.teacherId,
    };
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query: CREATE,
      variables: { input: sectionInput({ ...own, [field]: foreign[field] }) },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it('assignClassTeacher should set its own staff member on its own section', async () => {
    const res = await request<{ assignClassTeacher: { classTeacherId: string } }>({
      query: ASSIGN_TEACHER,
      variables: { sectionId: a.sectionId, classTeacherId: a.teacherId },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const [row] = await asAdmin((tx) =>
      tx
        .select({ classTeacherId: sections.classTeacherId })
        .from(sections)
        .where(eq(sections.id, a.sectionId)),
    );
    expect(row).toEqual({ classTeacherId: a.teacherId });
  });

  it.each([
    [
      'sectionId',
      () => ({ sectionId: b.sectionId, classTeacherId: a.teacherId }),
      ErrorCode.SECTION_NOT_FOUND,
    ],
    [
      'classTeacherId',
      () => ({ sectionId: a.sectionId, classTeacherId: b.teacherId }),
      ErrorCode.MEMBERSHIP_NOT_FOUND,
    ],
  ] as const)('assignClassTeacher should refuse %s of another institute and store no reference to it', async (_field, variables, code) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query: ASSIGN_TEACHER,
      variables: variables(),
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it.each([
    ['id', () => ({ id: b.sectionId, input: { room: 'Room 9' } }), ErrorCode.SECTION_NOT_FOUND],
    [
      'input.classTeacherId',
      () => ({ id: a.sectionId, input: { classTeacherId: b.teacherId } }),
      ErrorCode.MEMBERSHIP_NOT_FOUND,
    ],
  ] as const)('updateSection should refuse %s of another institute and store no reference to it', async (_field, variables, code) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query: UPDATE,
      variables: variables(),
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it('deleteSection should refuse a section of another institute and change neither institute', async () => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await request({
      query: DELETE,
      variables: { id: b.sectionId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.SECTION_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });
});
