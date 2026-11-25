/**
 * ROV-293: every student operation that takes an id refuses a student, year record, academic
 * year, class, section or file of another institute, returns none of its data, and stores no
 * reference to it.
 */
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, ErrorCode, SocialCategory } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  files,
  groups,
  memberships,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { Connection } from '@temporalio/client';
import { eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../../files/scan/file-scanner';

const ORIGIN = 'test:student-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const CSV = Buffer.from('First Name,Last Name\nAarav,Mehta\n');

const GET = /* GraphQL */ `
  query GetStudent($id: ID!) {
    getStudent(id: $id) {
      id
      admissionNumber
    }
  }
`;
const DOCUMENTS = /* GraphQL */ `
  query ListStudentDocuments($id: ID!) {
    listStudentDocuments(studentProfileId: $id) {
      id
    }
  }
`;
const ACADEMICS = /* GraphQL */ `
  query ListStudentAcademics($id: ID!) {
    listStudentAcademics(studentProfileId: $id) {
      id
      academicYearId
      standardId
      sectionId
    }
  }
`;
const LIST = /* GraphQL */ `
  query ListStudents($filter: StudentFilterInput) {
    listStudents(filter: $filter) {
      totalCount
      edges {
        node {
          id
        }
      }
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateStudent($id: ID!) {
    updateStudent(id: $id, input: { version: 1, firstName: { en: "Renamed" } }) {
      id
    }
  }
`;
const TRANSITION = /* GraphQL */ `
  mutation TransitionStudentStatus($id: ID!) {
    transitionStudentStatus(id: $id, newStatus: WITHDRAWN, reason: "Family moved") {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteStudent($id: ID!) {
    deleteStudent(id: $id)
  }
`;
const RESTORE = /* GraphQL */ `
  mutation RestoreStudent($id: ID!) {
    restoreStudent(id: $id)
  }
`;
const REMOVE_FROM_YEAR = /* GraphQL */ `
  mutation RemoveStudentFromYear($id: ID!) {
    removeStudentFromYear(studentAcademicId: $id, reason: "Admitted by mistake")
  }
`;
const ENROLL = /* GraphQL */ `
  mutation EnrollStudent($input: EnrollStudentInput!) {
    enrollStudent(input: $input)
  }
`;
const CHANGE_SECTION = /* GraphQL */ `
  mutation UpdateStudentSection($input: UpdateStudentSectionInput!) {
    updateStudentSection(input: $input)
  }
`;
const CHANGE_CLASS = /* GraphQL */ `
  mutation ChangeStudentClass($input: ChangeStudentClassInput!) {
    changeStudentClass(input: $input)
  }
`;
const PROMOTION = /* GraphQL */ `
  mutation SetPromotionDecisions($ids: [ID!]!) {
    setPromotionDecisions(input: { studentAcademicIds: $ids, status: PROMOTED })
  }
`;
const BULK = /* GraphQL */ `
  mutation BulkCreateStudents($input: BulkCreateStudentsInput!) {
    bulkCreateStudents(input: $input) {
      workflowId
    }
  }
`;

interface Fixture {
  prevYearId: string;
  yearId: string;
  /** Class 5 of the active year, with sections A and B. */
  standardId: string;
  sectionId: string;
  otherSectionId: string;
  /** Class 6 of the active year, with section A. */
  nextStandardId: string;
  nextSectionId: string;
  /** Placed in Class 5-A of the active year. */
  studentId: string;
  academicId: string;
  /** Placed only in last year's Class 4-A. */
  unplacedStudentId: string;
  /** Has no year record at all. */
  newStudentId: string;
  deletedStudentId: string;
  /** A student CSV the institute's admin uploaded and has not imported yet. */
  csvFileId: string;
}

describe('student: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  const storage = new FakeStorageClient();
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /**
   * Student, year-record, membership, profile-copy, section, group and file rows of both
   * institutes, and every year record anywhere that points at B's rows.
   */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignStudents = [
        b.studentId,
        b.unplacedStudentId,
        b.newStudentId,
        b.deletedStudentId,
      ];
      const foreignStandards = [b.standardId, b.nextStandardId];
      const foreignSections = [b.sectionId, b.otherSectionId, b.nextSectionId];
      return {
        students: await tx
          .select()
          .from(studentProfiles)
          .where(inArray(studentProfiles.tenantId, tenants))
          .orderBy(studentProfiles.id),
        academics: await tx
          .select()
          .from(studentAcademics)
          .where(
            or(
              inArray(studentAcademics.tenantId, tenants),
              inArray(studentAcademics.studentProfileId, foreignStudents),
              inArray(studentAcademics.academicYearId, [b.prevYearId, b.yearId]),
              inArray(studentAcademics.standardId, foreignStandards),
              inArray(studentAcademics.promotedToStandardId, foreignStandards),
              inArray(studentAcademics.sectionId, foreignSections),
            ),
          )
          .orderBy(studentAcademics.id),
        memberships: await tx
          .select()
          .from(memberships)
          .where(inArray(memberships.tenantId, tenants))
          .orderBy(memberships.id),
        copies: await tx
          .select()
          .from(tenantUserProfiles)
          .where(inArray(tenantUserProfiles.tenantId, tenants))
          .orderBy(tenantUserProfiles.id),
        sections: await tx
          .select()
          .from(sections)
          .where(inArray(sections.tenantId, tenants))
          .orderBy(sections.id),
        groups: await tx
          .select()
          .from(groups)
          .where(inArray(groups.tenantId, tenants))
          .orderBy(groups.id),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.tenantId, tenants),
              inArray(files.uploadedBy, [instA.userId, instB.userId]),
            ),
          )
          .orderBy(files.id),
      };
    });

  /** A student CSV the institute's admin uploaded and has not imported yet. */
  const addCsv = async (tx: DrizzleDB, inst: TestInstitute) => {
    const objectKey = `institutes/${inst.tenantId}/bulk-import/${randomUUID()}.csv`;
    await storage.put('private', `pending/${objectKey}`, CSV, { contentType: 'text/csv' });
    const [csv] = await tx
      .insert(files)
      .values({
        tenantId: inst.tenantId,
        visibility: 'PRIVATE',
        purpose: 'BULK_IMPORT_CSV',
        objectKey,
        originalName: 'students.csv',
        contentType: 'text/csv',
        sizeBytes: CSV.length,
        status: 'PENDING',
        uploadedBy: inst.userId,
        createdBy: inst.userId,
        updatedBy: inst.userId,
      })
      .returning({ id: files.id });
    return csv.id;
  };

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Fixture> => {
      const tenantId = inst.tenantId;
      const [prevYear, year] = await tx
        .insert(academicYears)
        .values([
          {
            tenantId,
            label: '2025-26',
            startDate: '2025-04-01',
            endDate: '2026-03-31',
            status: 'ARCHIVED' as const,
            ...BY,
          },
          {
            tenantId,
            label: '2026-27',
            startDate: '2026-04-01',
            endDate: '2027-03-31',
            isActive: true,
            status: 'ACTIVE' as const,
            ...BY,
          },
        ])
        .returning({ id: academicYears.id });
      const addStandard = async (academicYearId: string, order: number) => {
        const [row] = await tx
          .insert(standards)
          .values({
            tenantId,
            academicYearId,
            name: { en: `Class ${order}` },
            numericOrder: order,
            level: 'PRIMARY',
            ...BY,
          })
          .returning({ id: standards.id });
        return row.id;
      };
      const addSection = async (academicYearId: string, standardId: string, name: string) => {
        const [row] = await tx
          .insert(sections)
          .values({
            tenantId,
            standardId,
            academicYearId,
            name: { en: name },
            displayLabel: name,
            capacity: 40,
            ...BY,
          })
          .returning({ id: sections.id });
        return row.id;
      };
      const addStudent = async (deletedAt: Date | null = null) => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx
          .insert(users)
          .values({
            email: `student_fid_${suffix}@test.local`,
            username: `student_fid_${suffix}`,
            passwordHash: 'not-a-real-hash',
            ...BY,
          })
          .returning({ id: users.id });
        await tx
          .insert(userProfiles)
          .values({ userId: user.id, firstName: { en: `Student ${suffix}` }, ...BY });
        await tx.insert(tenantUserProfiles).values({
          tenantId,
          userId: user.id,
          firstName: { en: `Student ${suffix}` },
          ...BY,
        });
        const [membership] = await tx
          .insert(memberships)
          .values({ userId: user.id, roleId: inst.roleId, tenantId, abilities: [], ...BY })
          .returning({ id: memberships.id });
        const [profile] = await tx
          .insert(studentProfiles)
          .values({
            tenantId,
            userId: user.id,
            membershipId: membership.id,
            admissionNumber: `ADM-${suffix}`,
            admissionDate: '2025-04-01',
            admissionType: AdmissionType.NEW,
            academicStatus: AcademicStatus.ENROLLED,
            socialCategory: SocialCategory.GENERAL,
            deletedAt,
            deletedBy: deletedAt ? SYSTEM_USER_ID : null,
            ...BY,
          })
          .returning({ id: studentProfiles.id });
        return profile.id;
      };
      const addAcademic = async (
        studentProfileId: string,
        academicYearId: string,
        standardId: string,
        sectionId: string,
      ) => {
        const [row] = await tx
          .insert(studentAcademics)
          .values({ tenantId, studentProfileId, academicYearId, standardId, sectionId, ...BY })
          .returning({ id: studentAcademics.id });
        return row.id;
      };

      const prevStandardId = await addStandard(prevYear.id, 4);
      const prevSectionId = await addSection(prevYear.id, prevStandardId, 'Class 4-A');
      const standardId = await addStandard(year.id, 5);
      const sectionId = await addSection(year.id, standardId, 'Class 5-A');
      const otherSectionId = await addSection(year.id, standardId, 'Class 5-B');
      const nextStandardId = await addStandard(year.id, 6);
      const nextSectionId = await addSection(year.id, nextStandardId, 'Class 6-A');

      const studentId = await addStudent();
      const academicId = await addAcademic(studentId, year.id, standardId, sectionId);
      const unplacedStudentId = await addStudent();
      await addAcademic(unplacedStudentId, prevYear.id, prevStandardId, prevSectionId);
      const newStudentId = await addStudent();
      const deletedStudentId = await addStudent(new Date());

      return {
        prevYearId: prevYear.id,
        yearId: year.id,
        standardId,
        sectionId,
        otherSectionId,
        nextStandardId,
        nextSectionId,
        studentId,
        academicId,
        unplacedStudentId,
        newStudentId,
        deletedStudentId,
        csvFileId: await addCsv(tx, inst),
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

  const listIds = async (filter: Record<string, string>) => {
    const res = await gqlRequest<{
      listStudents: { totalCount: number; edges: { node: { id: string } }[] };
    }>(result.httpServer, { query: LIST, variables: { filter }, token: tokenA });
    expect(res.errors).toBeUndefined();
    return {
      totalCount: res.data?.listStudents.totalCount,
      ids: res.data?.listStudents.edges.map((edge) => edge.node.id),
    };
  };

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
      ],
    });
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

  it.each([
    ['getStudent', GET],
    ['listStudentDocuments', DOCUMENTS],
    ['listStudentAcademics', ACADEMICS],
  ] as const)('%s should refuse a student of another institute and return none of it', async (_operation, query) => {
    const res = await gqlRequest(result.httpServer, {
      query,
      variables: { id: b.studentId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it('listStudentAcademics should list the year records of its own student', async () => {
    const own = await gqlRequest<{ listStudentAcademics: unknown[] }>(result.httpServer, {
      query: ACADEMICS,
      variables: { id: a.studentId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.listStudentAcademics).toEqual([
      {
        id: a.academicId,
        academicYearId: a.yearId,
        standardId: a.standardId,
        sectionId: a.sectionId,
      },
    ]);
  });

  it.each([
    ['academicYearId', 'yearId', 'studentId'],
    ['standardId', 'standardId', 'studentId'],
    ['sectionId', 'sectionId', 'studentId'],
    ['notPlacedInYearId', 'yearId', 'unplacedStudentId'],
  ] as const)('listStudents should list its own %s and no student of another institute', async (filter, key, expected) => {
    expect(await listIds({ [filter]: a[key] })).toEqual({ totalCount: 1, ids: [a[expected]] });
    expect(await listIds({ [filter]: b[key] })).toEqual({ totalCount: 0, ids: [] });
  });

  it('listStudents should find its own student by membership id and none of another institute (ROV-360)', async () => {
    const membershipOf = (studentId: string) =>
      asAdmin(async (tx) => {
        const [row] = await tx
          .select({ membershipId: studentProfiles.membershipId })
          .from(studentProfiles)
          .where(eq(studentProfiles.id, studentId));
        return row.membershipId;
      });

    expect(await listIds({ membershipId: await membershipOf(a.studentId) })).toEqual({
      totalCount: 1,
      ids: [a.studentId],
    });
    expect(await listIds({ membershipId: await membershipOf(b.studentId) })).toEqual({
      totalCount: 0,
      ids: [],
    });
  });

  it.each([
    ['updateStudent', UPDATE, () => b.studentId],
    ['transitionStudentStatus', TRANSITION, () => b.studentId],
    ['deleteStudent', DELETE, () => b.studentId],
    ['restoreStudent', RESTORE, () => b.deletedStudentId],
  ] as const)('%s should refuse a student of another institute and change neither institute', async (_operation, query, id) => {
    await refusesAndWritesNothing(query, { id: id() }, ErrorCode.STUDENT_NOT_FOUND);
  });

  it('removeStudentFromYear should refuse a year record of another institute and change neither institute', async () => {
    await refusesAndWritesNothing(
      REMOVE_FROM_YEAR,
      { id: b.academicId },
      ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
    );
  });

  it.each([
    ['alone', () => [b.academicId]],
    ['mixed with its own', () => [a.academicId, b.academicId]],
  ] as const)('setPromotionDecisions should refuse a year record of another institute %s and write nothing', async (_case, ids) => {
    await refusesAndWritesNothing(PROMOTION, { ids: ids() }, ErrorCode.STUDENT_ACADEMIC_NOT_FOUND);
  });

  it.each([
    ['studentProfileId', () => ({ studentProfileId: b.newStudentId }), ErrorCode.STUDENT_NOT_FOUND],
    ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['standardId', () => ({ standardId: b.standardId }), ErrorCode.STANDARD_NOT_FOUND],
    ['sectionId', () => ({ sectionId: b.sectionId }), ErrorCode.SECTION_NOT_FOUND],
  ] as const)('enrollStudent should refuse %s of another institute and write nothing', async (_field, foreign, code) => {
    const input = {
      studentProfileId: a.newStudentId,
      academicYearId: a.yearId,
      standardId: a.standardId,
      sectionId: a.sectionId,
      ...foreign(),
    };
    await refusesAndWritesNothing(ENROLL, { input }, code);
  });

  it.each([
    [
      'studentAcademicId',
      () => ({ studentAcademicId: b.academicId, newSectionId: a.otherSectionId }),
      ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
    ],
    [
      'newSectionId',
      () => ({ studentAcademicId: a.academicId, newSectionId: b.otherSectionId }),
      ErrorCode.SECTION_NOT_FOUND,
    ],
  ] as const)('updateStudentSection should refuse %s of another institute and write nothing', async (_field, input, code) => {
    await refusesAndWritesNothing(CHANGE_SECTION, { input: input() }, code);
  });

  it.each([
    [
      'studentAcademicId',
      () => ({ studentAcademicId: b.academicId }),
      ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
    ],
    ['standardId', () => ({ standardId: b.nextStandardId }), ErrorCode.STANDARD_NOT_FOUND],
    ['sectionId', () => ({ sectionId: b.nextSectionId }), ErrorCode.SECTION_NOT_FOUND],
  ] as const)('changeStudentClass should refuse %s of another institute and write nothing', async (_field, foreign, code) => {
    const input = {
      studentAcademicId: a.academicId,
      standardId: a.nextStandardId,
      sectionId: a.nextSectionId,
      ...foreign(),
    };
    await refusesAndWritesNothing(CHANGE_CLASS, { input }, code);
  });

  it.each([
    ['fileId', () => ({ fileId: b.csvFileId }), ErrorCode.FILE_NOT_FOUND],
    ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ['standardId', () => ({ standardId: b.standardId }), ErrorCode.STANDARD_NOT_FOUND],
    ['sectionId', () => ({ sectionId: b.sectionId }), ErrorCode.SECTION_NOT_FOUND],
  ] as const)('bulkCreateStudents should refuse %s of another institute, start no import and write nothing', async (_field, foreign, code) => {
    // Nothing may reach Temporal; a refused import must not start a workflow.
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));
    // Its own upload each time: an import that wrongly starts claims the file it was given.
    const fileId = await asAdmin((tx) => addCsv(tx, instA));
    const input = {
      fileId,
      academicYearId: a.yearId,
      standardId: a.standardId,
      sectionId: a.sectionId,
      fieldMapping: { 'First Name': 'first_name', 'Last Name': 'last_name' },
      ...foreign(),
    };

    await refusesAndWritesNothing(BULK, { input }, code);
    expect(connect).not.toHaveBeenCalled();
  });
});
