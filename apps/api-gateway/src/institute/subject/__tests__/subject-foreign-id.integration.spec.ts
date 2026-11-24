/**
 * ROV-293: every subject operation that takes an id refuses a subject, standard, section or
 * academic year of another institute, returns none of its data, and stores no link to it.
 */
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sectionSubjects,
  sections,
  standardSubjects,
  standards,
  subjects,
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
import { eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:subject-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const SUBJECT = /* GraphQL */ `
  query Subject($id: ID!) {
    subject(id: $id) {
      id
      name
    }
  }
`;
const SUBJECTS_BY_STANDARD = /* GraphQL */ `
  query SubjectsByStandard($standardId: ID!) {
    subjectsByStandard(standardId: $standardId) {
      id
    }
  }
`;
const SUBJECTS_BY_YEAR = /* GraphQL */ `
  query SubjectsByAcademicYear($academicYearId: ID) {
    subjectsByAcademicYear(academicYearId: $academicYearId) {
      id
      standardId
    }
  }
`;
const CREATE = /* GraphQL */ `
  mutation CreateSubject($standardIds: [ID!], $sectionIds: [ID!]) {
    createSubject(input: { name: "Physics", standardIds: $standardIds, sectionIds: $sectionIds }) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateSubject($id: ID!) {
    updateSubject(id: $id, input: { name: "Renamed" }) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteSubject($id: ID!) {
    deleteSubject(id: $id)
  }
`;
const link = (operation: string, target: 'standardId' | 'sectionId') => /* GraphQL */ `
  mutation Link($subjectId: ID!, $targetId: ID!) {
    ${operation}(subjectId: $subjectId, ${target}: $targetId) {
      id
      name
    }
  }
`;

interface Structure {
  yearId: string;
  standardId: string;
  sectionId: string;
  subjectId: string;
}

describe('subject: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Structure;
  let b: Structure;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Subjects and links of both institutes, and every link in any institute to the other's rows. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      return {
        subjects: await tx
          .select()
          .from(subjects)
          .where(inArray(subjects.tenantId, tenants))
          .orderBy(subjects.id),
        standardLinks: await tx
          .select()
          .from(standardSubjects)
          .where(
            or(
              inArray(standardSubjects.tenantId, tenants),
              eq(standardSubjects.standardId, b.standardId),
              eq(standardSubjects.subjectId, b.subjectId),
            ),
          )
          .orderBy(standardSubjects.id),
        sectionLinks: await tx
          .select()
          .from(sectionSubjects)
          .where(
            or(
              inArray(sectionSubjects.tenantId, tenants),
              eq(sectionSubjects.sectionId, b.sectionId),
              eq(sectionSubjects.subjectId, b.subjectId),
            ),
          )
          .orderBy(sectionSubjects.id),
      };
    });

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Structure> => {
      const tenantId = inst.tenantId;
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId,
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
          tenantId,
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
          tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      const [subject] = await tx
        .insert(subjects)
        .values({ tenantId, name: 'Mathematics', ...BY })
        .returning({ id: subjects.id });
      await tx
        .insert(standardSubjects)
        .values({ tenantId, subjectId: subject.id, standardId: standard.id, ...BY });
      await tx
        .insert(sectionSubjects)
        .values({ tenantId, subjectId: subject.id, sectionId: section.id, ...BY });
      return {
        yearId: year.id,
        standardId: standard.id,
        sectionId: section.id,
        subjectId: subject.id,
      };
    });

  const refusesAndWritesNothing = async (
    query: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, { query, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  };

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

  it('subject should refuse a subject of another institute and return none of it', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: SUBJECT,
      variables: { id: b.subjectId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.SUBJECT_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it('subjectsByStandard should list its own standard and nothing of another institute standard', async () => {
    const own = await gqlRequest<{ subjectsByStandard: { id: string }[] }>(result.httpServer, {
      query: SUBJECTS_BY_STANDARD,
      variables: { standardId: a.standardId },
      token: tokenA,
    });
    const foreign = await gqlRequest<{ subjectsByStandard: { id: string }[] }>(result.httpServer, {
      query: SUBJECTS_BY_STANDARD,
      variables: { standardId: b.standardId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.subjectsByStandard).toEqual([{ id: a.subjectId }]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.subjectsByStandard).toEqual([]);
  });

  it('subjectsByAcademicYear should list its own year and nothing of another institute year', async () => {
    const own = await gqlRequest<{ subjectsByAcademicYear: unknown[] }>(result.httpServer, {
      query: SUBJECTS_BY_YEAR,
      variables: { academicYearId: a.yearId },
      token: tokenA,
    });
    const foreign = await gqlRequest<{ subjectsByAcademicYear: unknown[] }>(result.httpServer, {
      query: SUBJECTS_BY_YEAR,
      variables: { academicYearId: b.yearId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.subjectsByAcademicYear).toEqual([
      { id: a.subjectId, standardId: a.standardId },
    ]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.subjectsByAcademicYear).toEqual([]);
  });

  it('createSubject should create a subject linked to its own class and section', async () => {
    const res = await gqlRequest<{ createSubject: { id: string } }>(result.httpServer, {
      query: CREATE,
      variables: { standardIds: [a.standardId], sectionIds: [a.sectionId] },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const id = res.data?.createSubject.id ?? '';
    const links = await asAdmin(async (tx) => ({
      standards: await tx
        .select({ standardId: standardSubjects.standardId })
        .from(standardSubjects)
        .where(eq(standardSubjects.subjectId, id)),
      sections: await tx
        .select({ sectionId: sectionSubjects.sectionId })
        .from(sectionSubjects)
        .where(eq(sectionSubjects.subjectId, id)),
    }));
    expect(links).toEqual({
      standards: [{ standardId: a.standardId }],
      sections: [{ sectionId: a.sectionId }],
    });
  });

  it.each([
    [
      'input.standardIds',
      () => ({ standardIds: [b.standardId], sectionIds: [a.sectionId] }),
      ErrorCode.STANDARD_NOT_FOUND,
    ],
    [
      'input.sectionIds',
      () => ({ standardIds: [a.standardId], sectionIds: [b.sectionId] }),
      ErrorCode.SECTION_NOT_FOUND,
    ],
  ] as const)('createSubject should refuse %s of another institute and write nothing', async (_field, variables, code) => {
    await refusesAndWritesNothing(CREATE, variables(), code);
  });

  it.each([
    ['updateSubject', UPDATE, ErrorCode.SUBJECT_NOT_FOUND],
    ['deleteSubject', DELETE, ErrorCode.NOT_FOUND],
  ] as const)('%s should refuse a subject of another institute and change neither institute', async (_operation, query, code) => {
    await refusesAndWritesNothing(query, { id: b.subjectId }, code);
  });

  // Removals first: a link left behind by a failed assign would give them a row to remove.
  describe.each([
    ['removeSubjectFromStandard', 'standardId', 'standardId', ErrorCode.STANDARD_NOT_FOUND],
    ['removeSubjectFromSection', 'sectionId', 'sectionId', ErrorCode.SECTION_NOT_FOUND],
    ['assignSubjectToStandard', 'standardId', 'standardId', ErrorCode.STANDARD_NOT_FOUND],
    ['assignSubjectToSection', 'sectionId', 'sectionId', ErrorCode.SECTION_NOT_FOUND],
  ] as const)('%s', (operation, target, key, targetCode) => {
    const query = link(operation, target);

    it('should refuse subjectId of another institute and store or change no link', async () => {
      await refusesAndWritesNothing(
        query,
        { subjectId: b.subjectId, targetId: a[key] },
        ErrorCode.SUBJECT_NOT_FOUND,
      );
    });

    it(`should refuse ${target} of another institute and store or change no link`, async () => {
      await refusesAndWritesNothing(
        query,
        { subjectId: a.subjectId, targetId: b[key] },
        targetCode,
      );
    });

    it("should refuse the other institute's own link and leave it unchanged", async () => {
      await refusesAndWritesNothing(
        query,
        { subjectId: b.subjectId, targetId: b[key] },
        ErrorCode.SUBJECT_NOT_FOUND,
      );
    });
  });
});
