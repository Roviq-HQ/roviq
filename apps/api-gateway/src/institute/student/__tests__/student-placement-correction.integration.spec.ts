/**
 * ROV-322 — correcting one student after a rollover: change class, place a skipped student,
 * remove a student from one year. Real PostgreSQL + RLS.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DomainGroupType,
  Gender,
  GroupMembershipType,
  PromotionStatus,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  attendanceEntries,
  attendanceSessions,
  type DrizzleDB,
  examMarks,
  examSchedules,
  exams,
  groupRules,
  groups,
  instituteConfigs,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  subjects,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import {
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { GroupInvalidationHandler } from '../../group/group-invalidation.handler';
import { rollOverStudents } from '../year-rollover';

const ORIGIN = 'test:student-placement-correction';

const audit = (tenantId: string) => ({
  tenantId,
  createdBy: SYSTEM_USER_ID,
  updatedBy: SYSTEM_USER_ID,
});

function addYears(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [prev, next] = await tx
      .insert(academicYears)
      .values([
        {
          ...audit(tenantId),
          label: '2025-26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          status: 'ARCHIVED' as const,
        },
        {
          ...audit(tenantId),
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE' as const,
        },
      ])
      .returning({ id: academicYears.id });
    return { prevYearId: prev.id, nextYearId: next.id };
  });
}

function addStandard(db: DrizzleDB, tenantId: string, academicYearId: string, order: number) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [row] = await tx
      .insert(standards)
      .values({
        ...audit(tenantId),
        academicYearId,
        name: { en: `Class ${order}` },
        numericOrder: order,
        level: 'PRIMARY' as const,
      })
      .returning({ id: standards.id });
    return row.id;
  });
}

function addSection(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
  standardId: string,
  name: string,
) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [row] = await tx
      .insert(sections)
      .values({
        ...audit(tenantId),
        standardId,
        academicYearId,
        name: { en: name },
        displayLabel: name,
        displayOrder: 1,
        capacity: 40,
      })
      .returning({ id: sections.id });
    return row.id;
  });
}

interface Student {
  profileId: string;
  membershipId: string;
}

function addStudent(
  db: DrizzleDB,
  tenantId: string,
  academicStatus: AcademicStatus = AcademicStatus.ENROLLED,
): Promise<Student> {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });
    const [user] = await tx
      .insert(users)
      .values({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        email: `place_${suffix}@test.local`,
        username: `place_${suffix}`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    await tx.insert(userProfiles).values({
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Sharma' },
      gender: Gender.FEMALE,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    // The institute's own copy: its lists read this, not the account profile.
    await tx.insert(tenantUserProfiles).values({
      ...audit(tenantId),
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Sharma' },
      gender: Gender.FEMALE,
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ ...audit(tenantId), userId: user.id, roleId: role.id, abilities: [] })
      .returning({ id: memberships.id });
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        ...audit(tenantId),
        userId: user.id,
        membershipId: membership.id,
        admissionNumber: `ADM-${suffix}`,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus,
        socialCategory: SocialCategory.GENERAL,
      })
      .returning({ id: studentProfiles.id });
    return { profileId: profile.id, membershipId: membership.id };
  });
}

function addAcademic(
  db: DrizzleDB,
  tenantId: string,
  row: {
    studentProfileId: string;
    academicYearId: string;
    standardId: string;
    sectionId: string;
    promotionStatus?: PromotionStatus;
    promotedToStandardId?: string;
  },
) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [inserted] = await tx
      .insert(studentAcademics)
      .values({
        ...audit(tenantId),
        ...row,
        promotionStatus: row.promotionStatus ?? null,
        promotedToStandardId: row.promotedToStandardId ?? null,
      })
      .returning({ id: studentAcademics.id });
    return inserted.id;
  });
}

function addGroups(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [bySection, byStandard, hybrid, staticGroup] = await tx
      .insert(groups)
      .values([
        {
          ...audit(tenantId),
          name: 'By section',
          groupType: DomainGroupType.SECTION,
          membershipType: GroupMembershipType.DYNAMIC,
          resolvedAt: new Date(),
        },
        {
          ...audit(tenantId),
          name: 'By standard',
          groupType: DomainGroupType.SECTION,
          membershipType: GroupMembershipType.DYNAMIC,
          resolvedAt: new Date(),
        },
        {
          ...audit(tenantId),
          name: 'Hybrid',
          groupType: DomainGroupType.CLUB,
          membershipType: GroupMembershipType.HYBRID,
          resolvedAt: new Date(),
        },
        {
          ...audit(tenantId),
          name: 'Static',
          groupType: DomainGroupType.CLUB,
          membershipType: GroupMembershipType.STATIC,
          resolvedAt: new Date(),
        },
      ])
      .returning({ id: groups.id });
    await tx.insert(groupRules).values([
      {
        ...audit(tenantId),
        groupId: bySection.id,
        rule: { '==': [{ var: 'section_id' }, randomUUID()] },
        ruleDimensions: ['section_id'],
      },
      {
        ...audit(tenantId),
        groupId: byStandard.id,
        rule: { '==': [{ var: 'standard_id' }, randomUUID()] },
        ruleDimensions: ['standard_id'],
      },
    ]);
    return {
      bySection: bySection.id,
      byStandard: byStandard.id,
      hybrid: hybrid.id,
      staticGroup: staticGroup.id,
    };
  });
}

type Groups = Awaited<ReturnType<typeof addGroups>>;

const CHANGE = `
  mutation Change($input: ChangeStudentClassInput!) { changeStudentClass(input: $input) }`;
const REMOVE = `
  mutation Remove($id: ID!, $reason: String!) {
    removeStudentFromYear(studentAcademicId: $id, reason: $reason)
  }`;
const ENROLL = `mutation Enroll($input: EnrollStudentInput!) { enrollStudent(input: $input) }`;
const LIST = `
  query List($filter: StudentFilterInput) {
    listStudents(filter: $filter) {
      totalCount
      edges { node { id currentStandardId currentSectionId } }
      pageInfo { hasNextPage }
    }
  }`;

interface ListData {
  listStudents: {
    totalCount: number;
    edges: {
      node: { id: string; currentStandardId: string | null; currentSectionId: string | null };
    }[];
    pageInfo: { hasNextPage: boolean };
  };
}

describe('Student placement correction (integration)', () => {
  let result: IntegrationAppResult;
  let groupHandler: GroupInvalidationHandler;
  const teachers: TestTeacher[] = [];

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  const teacherToken = async (inst: TestInstitute) => {
    const teacher = await createTestTeacher(result.db, inst.tenantId);
    teachers.push(teacher);
    return {
      teacher,
      token: createInstituteToken({
        sub: teacher.userId,
        tenantId: inst.tenantId,
        membershipId: teacher.membershipId,
        roleId: teacher.roleId,
      }),
    };
  };

  const gql = <T>(query: string, variables: Record<string, unknown>, token: string) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });

  const rowsOf = (tenantId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          id: studentAcademics.id,
          studentProfileId: studentAcademics.studentProfileId,
          academicYearId: studentAcademics.academicYearId,
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
          promotionStatus: studentAcademics.promotionStatus,
          promotedToStandardId: studentAcademics.promotedToStandardId,
          updatedBy: studentAcademics.updatedBy,
          deletedAt: studentAcademics.deletedAt,
          deletedBy: studentAcademics.deletedBy,
          version: studentAcademics.version,
        })
        .from(studentAcademics)
        .where(eq(studentAcademics.tenantId, tenantId))
        .orderBy(studentAcademics.id),
    );

  const rowById = async (id: string) => {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
          promotionStatus: studentAcademics.promotionStatus,
          promotedToStandardId: studentAcademics.promotedToStandardId,
          updatedBy: studentAcademics.updatedBy,
          deletedAt: studentAcademics.deletedAt,
          deletedBy: studentAcademics.deletedBy,
          version: studentAcademics.version,
        })
        .from(studentAcademics)
        .where(eq(studentAcademics.id, id)),
    );
    if (!row) throw new Error(`fixture: no student_academics ${id}`);
    return row;
  };

  const liveRowsIn = (studentProfileId: string, academicYearId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
        })
        .from(studentAcademics)
        .where(
          and(
            eq(studentAcademics.studentProfileId, studentProfileId),
            eq(studentAcademics.academicYearId, academicYearId),
            isNull(studentAcademics.deletedAt),
          ),
        ),
    );

  const resolvedAt = async (ids: string[]) => {
    const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ id: groups.id, resolvedAt: groups.resolvedAt })
        .from(groups)
        .where(inArray(groups.id, ids)),
    );
    return new Map(rows.map((r) => [r.id, r.resolvedAt === null ? 'unresolved' : 'resolved']));
  };

  const markResolved = (ids: string[]) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.update(groups).set({ resolvedAt: new Date() }).where(inArray(groups.id, ids)),
    );

  const listIds = async (filter: Record<string, unknown>, token: string) => {
    const response = await gql<ListData>(LIST, { filter: { first: 100, ...filter } }, token);
    expect(response.errors).toBeUndefined();
    return response.data?.listStudents.edges.map((e) => e.node.id).sort() ?? [];
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    groupHandler = result.app.get(GroupInvalidationHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const teacher of teachers) await cleanupTestTeacher(result.db, teacher);
    await result?.close();
  });

  describe('changeStudentClass', () => {
    let inst: TestInstitute;
    let otherInst: TestInstitute;
    let token: string;
    let years: { prevYearId: string; nextYearId: string };
    let prev5: string;
    let prev6: string;
    let next5: string;
    let next6: string;
    let next7: string;
    let n5A: string;
    let n6A: string;
    let n6B: string;
    let n7A: string;
    let other: {
      profileId: string;
      yearId: string;
      standardId: string;
      sectionId: string;
      academicId: string;
    };
    let instGroups: Groups;
    let otherGroups: Groups;

    /** Last year in `prevOrder`, this year in Class 6 section A. */
    const placedStudent = async (
      prevOrder: 5 | 6,
      prevStatus?: PromotionStatus,
      promotedToStandardId?: string,
    ) => {
      const student = await addStudent(result.db, inst.tenantId);
      const prevAcademicId = await addAcademic(result.db, inst.tenantId, {
        studentProfileId: student.profileId,
        academicYearId: years.prevYearId,
        standardId: prevOrder === 5 ? prev5 : prev6,
        sectionId: await addSection(
          result.db,
          inst.tenantId,
          years.prevYearId,
          prevOrder === 5 ? prev5 : prev6,
          `P${randomUUID().slice(0, 6)}`,
        ),
        promotionStatus: prevStatus,
        promotedToStandardId,
      });
      const academicId = await addAcademic(result.db, inst.tenantId, {
        studentProfileId: student.profileId,
        academicYearId: years.nextYearId,
        standardId: next6,
        sectionId: n6A,
      });
      return { ...student, prevAcademicId, academicId };
    };

    beforeAll(async () => {
      inst = await createTestInstitute(result.db);
      otherInst = await createTestInstitute(result.db);
      token = tokenFor(inst);
      years = await addYears(result.db, inst.tenantId);
      prev5 = await addStandard(result.db, inst.tenantId, years.prevYearId, 5);
      prev6 = await addStandard(result.db, inst.tenantId, years.prevYearId, 6);
      next5 = await addStandard(result.db, inst.tenantId, years.nextYearId, 5);
      next6 = await addStandard(result.db, inst.tenantId, years.nextYearId, 6);
      next7 = await addStandard(result.db, inst.tenantId, years.nextYearId, 7);
      n5A = await addSection(result.db, inst.tenantId, years.nextYearId, next5, '5-A');
      n6A = await addSection(result.db, inst.tenantId, years.nextYearId, next6, '6-A');
      n6B = await addSection(result.db, inst.tenantId, years.nextYearId, next6, '6-B');
      n7A = await addSection(result.db, inst.tenantId, years.nextYearId, next7, '7-A');

      const otherYears = await addYears(result.db, otherInst.tenantId);
      const otherStandard = await addStandard(
        result.db,
        otherInst.tenantId,
        otherYears.nextYearId,
        5,
      );
      const otherSection = await addSection(
        result.db,
        otherInst.tenantId,
        otherYears.nextYearId,
        otherStandard,
        '5-A',
      );
      const otherStudent = await addStudent(result.db, otherInst.tenantId);
      other = {
        profileId: otherStudent.profileId,
        yearId: otherYears.nextYearId,
        standardId: otherStandard,
        sectionId: otherSection,
        academicId: await addAcademic(result.db, otherInst.tenantId, {
          studentProfileId: otherStudent.profileId,
          academicYearId: otherYears.nextYearId,
          standardId: otherStandard,
          sectionId: otherSection,
        }),
      };
      instGroups = await addGroups(result.db, inst.tenantId);
      otherGroups = await addGroups(result.db, otherInst.tenantId);
    });

    it('should move a student down to Class 5, keep one live row and record last year as DETAINED', async () => {
      const student = await placedStudent(5, PromotionStatus.PROMOTED, prev6);
      const before = await rowById(student.academicId);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next5, sectionId: n5A } },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.changeStudentClass).toBe(student.academicId);
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([
        { standardId: next5, sectionId: n5A },
      ]);
      expect(await rowById(student.academicId)).toEqual({
        ...before,
        standardId: next5,
        sectionId: n5A,
        updatedBy: inst.userId,
        version: before.version + 1,
      });
      const prevRow = await rowById(student.prevAcademicId);
      expect(prevRow.promotionStatus).toBe(PromotionStatus.DETAINED);
      expect(prevRow.promotedToStandardId).toBeNull();
      expect(prevRow.updatedBy).toBe(inst.userId);
      expect(emit.mock.calls).toEqual([
        [
          EVENT_PATTERNS.STUDENT.section_changed,
          {
            studentProfileId: student.profileId,
            oldSectionId: n6A,
            newSectionId: n5A,
            tenantId: inst.tenantId,
          },
        ],
        [
          EVENT_PATTERNS.STUDENT.promoted,
          { studentProfileId: student.profileId, tenantId: inst.tenantId },
        ],
      ]);
    });

    it('should record last year as PROMOTED to the new class when moved up to Class 7, replacing a stale target', async () => {
      const student = await placedStudent(5, PromotionStatus.PROMOTED, prev6);

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next7, sectionId: n7A } },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([
        { standardId: next7, sectionId: n7A },
      ]);
      const prevRow = await rowById(student.prevAcademicId);
      expect(prevRow.promotionStatus).toBe(PromotionStatus.PROMOTED);
      expect(prevRow.promotedToStandardId).toBe(next7);
    });

    it('should leave a TRANSFERRED previous row alone', async () => {
      const student = await placedStudent(5, PromotionStatus.TRANSFERRED);
      const prevBefore = await rowById(student.prevAcademicId);

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next5, sectionId: n5A } },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(await rowById(student.prevAcademicId)).toEqual(prevBefore);
    });

    it('should leave last year unchanged when the new class is lower than last year’s', async () => {
      const student = await placedStudent(6, PromotionStatus.DETAINED);
      const prevBefore = await rowById(student.prevAcademicId);

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next5, sectionId: n5A } },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(await rowById(student.prevAcademicId)).toEqual(prevBefore);
    });

    it('should refuse each invalid target with its code and write nothing', async () => {
      const student = await placedStudent(5);
      const cases: [Record<string, string>, string][] = [
        [{ standardId: prev5, sectionId: n5A }, 'STANDARD_NOT_FOUND'],
        [{ standardId: next5, sectionId: n6B }, 'SECTION_NOT_FOUND'],
        [{ standardId: next6, sectionId: n6A }, 'VALIDATION_FAILED'],
        [{ standardId: other.standardId, sectionId: other.sectionId }, 'STANDARD_NOT_FOUND'],
        [{ standardId: next5, sectionId: other.sectionId }, 'SECTION_NOT_FOUND'],
        [
          { studentAcademicId: other.academicId, standardId: next5, sectionId: n5A },
          'STUDENT_ACADEMIC_NOT_FOUND',
        ],
      ];
      const before = await rowsOf(inst.tenantId);
      const otherBefore = await rowsOf(otherInst.tenantId);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      for (const [target, code] of cases) {
        const response = await gql<{ changeStudentClass: string }>(
          CHANGE,
          { input: { studentAcademicId: student.academicId, ...target } },
          token,
        );
        expect(response.data).toBeNull();
        expect(response.errors?.[0]?.extensions?.code).toBe(code);
      }

      expect(await rowsOf(inst.tenantId)).toEqual(before);
      expect(await rowsOf(otherInst.tenantId)).toEqual(otherBefore);
      expect(emit).not.toHaveBeenCalled();
    });

    it('should refuse to enrol with an id of another institute, another year or another class', async () => {
      const student = await addStudent(result.db, inst.tenantId);
      const valid = {
        studentProfileId: student.profileId,
        academicYearId: years.nextYearId,
        standardId: next5,
        sectionId: n5A,
      };
      const cases: [Record<string, string>, string][] = [
        [{ studentProfileId: other.profileId }, 'STUDENT_NOT_FOUND'],
        [{ academicYearId: other.yearId }, 'ACADEMIC_YEAR_NOT_FOUND'],
        [{ standardId: other.standardId }, 'STANDARD_NOT_FOUND'],
        [{ standardId: prev5 }, 'STANDARD_NOT_FOUND'],
        [{ sectionId: n6B }, 'SECTION_NOT_FOUND'],
        [{ sectionId: other.sectionId }, 'SECTION_NOT_FOUND'],
      ];
      const before = await rowsOf(inst.tenantId);
      const otherBefore = await rowsOf(otherInst.tenantId);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      for (const [wrong, code] of cases) {
        const response = await gql<{ enrollStudent: string }>(
          ENROLL,
          { input: { ...valid, ...wrong } },
          token,
        );
        expect(response.data).toBeNull();
        expect(response.errors?.[0]?.extensions?.code).toBe(code);
      }

      expect(await rowsOf(inst.tenantId)).toEqual(before);
      expect(await rowsOf(otherInst.tenantId)).toEqual(otherBefore);
      expect(emit).not.toHaveBeenCalled();

      const ok = await gql<{ enrollStudent: string }>(ENROLL, { input: valid }, token);
      expect(ok.errors).toBeUndefined();
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([
        { standardId: next5, sectionId: n5A },
      ]);
    });

    it('should mark section- and standard-based groups of this institute unresolved, not another’s', async () => {
      const student = await placedStudent(5);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');
      const all = [...Object.values(instGroups), ...Object.values(otherGroups)];
      await markResolved(all);

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next6, sectionId: n6B } },
        token,
      );
      expect(response.errors).toBeUndefined();
      const payloadOf = (pattern: string) => emit.mock.calls.find(([p]) => p === pattern)?.[1];
      await groupHandler.onStudentSectionChanged(payloadOf(EVENT_PATTERNS.STUDENT.section_changed));
      await groupHandler.onStudentPromoted(payloadOf(EVENT_PATTERNS.STUDENT.promoted));

      expect(await resolvedAt(all)).toEqual(
        new Map([
          [instGroups.bySection, 'unresolved'],
          [instGroups.byStandard, 'unresolved'],
          [instGroups.hybrid, 'resolved'],
          [instGroups.staticGroup, 'resolved'],
          [otherGroups.bySection, 'resolved'],
          [otherGroups.byStandard, 'resolved'],
          [otherGroups.hybrid, 'resolved'],
          [otherGroups.staticGroup, 'resolved'],
        ]),
      );
    });

    it('should refuse a role without update Student', async () => {
      const student = await placedStudent(5);
      const before = await rowsOf(inst.tenantId);
      const { token: teacher } = await teacherToken(inst);

      const response = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { studentAcademicId: student.academicId, standardId: next5, sectionId: n5A } },
        teacher,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await rowsOf(inst.tenantId)).toEqual(before);
    });

    it('should refuse a full section at the hard limit without overrideReason and accept it with one', async () => {
      const capped = await createTestInstitute(result.db);
      const cappedYears = await addYears(result.db, capped.tenantId);
      const s1 = await addStandard(result.db, capped.tenantId, cappedYears.nextYearId, 1);
      const s2 = await addStandard(result.db, capped.tenantId, cappedYears.nextYearId, 2);
      const sec1 = await addSection(result.db, capped.tenantId, cappedYears.nextYearId, s1, '1-A');
      const sec2 = await addSection(result.db, capped.tenantId, cappedYears.nextYearId, s2, '2-A');
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.insert(instituteConfigs).values({
          ...audit(capped.tenantId),
          sectionStrengthNorms: { optimal: 1, hardMax: 1, exemptionAllowed: true },
        }),
      );
      const mover = await addStudent(result.db, capped.tenantId);
      const occupant = await addStudent(result.db, capped.tenantId);
      const moverAcademic = await addAcademic(result.db, capped.tenantId, {
        studentProfileId: mover.profileId,
        academicYearId: cappedYears.nextYearId,
        standardId: s1,
        sectionId: sec1,
      });
      await addAcademic(result.db, capped.tenantId, {
        studentProfileId: occupant.profileId,
        academicYearId: cappedYears.nextYearId,
        standardId: s2,
        sectionId: sec2,
      });
      const cappedToken = tokenFor(capped);
      const input = { studentAcademicId: moverAcademic, standardId: s2, sectionId: sec2 };
      const before = await rowsOf(capped.tenantId);

      const refused = await gql<{ changeStudentClass: string }>(CHANGE, { input }, cappedToken);
      expect(refused.errors?.[0]?.extensions?.code).toBe('SECTION_CAPACITY_EXCEEDED');
      expect(await rowsOf(capped.tenantId)).toEqual(before);

      const accepted = await gql<{ changeStudentClass: string }>(
        CHANGE,
        { input: { ...input, overrideReason: 'Sibling in the same section' } },
        cappedToken,
      );
      expect(accepted.errors).toBeUndefined();
      expect(await liveRowsIn(mover.profileId, cappedYears.nextYearId)).toEqual([
        { standardId: s2, sectionId: sec2 },
      ]);
    });
  });

  describe('listStudents notPlacedInYearId', () => {
    let inst: TestInstitute;
    let otherInst: TestInstitute;
    let token: string;
    let years: { prevYearId: string; nextYearId: string };
    let otherYears: { prevYearId: string; nextYearId: string };
    let prev5: string;
    let prevSection5: string;
    let next5: string;
    let nextSection5: string;
    let skipped: Student;
    let skippedToo: Student;
    let placed: Student;
    let graduated: Student;
    let otherSkipped: Student;

    /** Levels 4, 5 and 6 last year; this year Class 6 has no section, so Class 5 cannot move up. */
    const buildInstitute = async (tenantId: string) => {
      const y = await addYears(result.db, tenantId);
      const levels = new Map<number, { prev: string; prevSection: string; next: string }>();
      for (const order of [4, 5, 6]) {
        const prev = await addStandard(result.db, tenantId, y.prevYearId, order);
        const next = await addStandard(result.db, tenantId, y.nextYearId, order);
        levels.set(order, {
          prev,
          prevSection: await addSection(result.db, tenantId, y.prevYearId, prev, `${order}-A`),
          next,
        });
      }
      const at = (order: number) => {
        const level = levels.get(order);
        if (!level) throw new Error(`fixture: no level ${order}`);
        return level;
      };
      const nextSections = new Map<number, string>();
      for (const order of [4, 5]) {
        nextSections.set(
          order,
          await addSection(result.db, tenantId, y.nextYearId, at(order).next, `${order}-A`),
        );
      }
      const studentAt = async (order: number, status?: AcademicStatus) => {
        const student = await addStudent(result.db, tenantId, status);
        await addAcademic(result.db, tenantId, {
          studentProfileId: student.profileId,
          academicYearId: y.prevYearId,
          standardId: at(order).prev,
          sectionId: at(order).prevSection,
          promotionStatus:
            status === AcademicStatus.GRADUATED ? PromotionStatus.GRADUATED : undefined,
        });
        return student;
      };
      return { y, at, nextSections, studentAt };
    };

    const rollOver = (tenantId: string, y: { prevYearId: string; nextYearId: string }) =>
      withTenant(result.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
        const { counts } = await rollOverStudents(tx, {
          tenantId,
          previousYearId: y.prevYearId,
          academicYearId: y.nextYearId,
          write: true,
        });
        return counts;
      });

    beforeAll(async () => {
      inst = await createTestInstitute(result.db);
      otherInst = await createTestInstitute(result.db);
      token = tokenFor(inst);

      const own = await buildInstitute(inst.tenantId);
      years = own.y;
      prev5 = own.at(5).prev;
      prevSection5 = own.at(5).prevSection;
      next5 = own.at(5).next;
      const section5 = own.nextSections.get(5);
      if (!section5) throw new Error('fixture: no Class 5 section this year');
      nextSection5 = section5;
      placed = await own.studentAt(4);
      skipped = await own.studentAt(5);
      skippedToo = await own.studentAt(5);
      graduated = await own.studentAt(6, AcademicStatus.GRADUATED);

      const theirs = await buildInstitute(otherInst.tenantId);
      otherYears = theirs.y;
      otherSkipped = await theirs.studentAt(5);

      expect(await rollOver(inst.tenantId, years)).toEqual({
        movingUp: 1,
        staying: 0,
        completing: 0,
        notCarried: 0,
        noClassInNewYear: 2,
        alreadyPlaced: 0,
      });
      await rollOver(otherInst.tenantId, otherYears);
    });

    it('should return exactly the skipped students, with their latest placement', async () => {
      const response = await gql<ListData>(
        LIST,
        { filter: { notPlacedInYearId: years.nextYearId, first: 100 } },
        token,
      );

      expect(response.errors).toBeUndefined();
      const byId = new Map(response.data?.listStudents.edges.map((e) => [e.node.id, e.node]));
      expect([...byId.keys()].sort()).toEqual([skipped.profileId, skippedToo.profileId].sort());
      expect(response.data?.listStudents.totalCount).toBe(2);
      expect(byId.get(skipped.profileId)).toEqual({
        id: skipped.profileId,
        currentStandardId: prev5,
        currentSectionId: prevSection5,
      });
      for (const never of [placed, graduated, otherSkipped]) {
        expect(byId.has(never.profileId)).toBe(false);
      }
    });

    it('should page through the result', async () => {
      const response = await gql<ListData>(
        LIST,
        { filter: { notPlacedInYearId: years.nextYearId, first: 1 } },
        token,
      );

      expect(response.data?.listStudents.edges).toHaveLength(1);
      expect(response.data?.listStudents.totalCount).toBe(2);
      expect(response.data?.listStudents.pageInfo.hasNextPage).toBe(true);
    });

    it("should return an empty list for another institute's year", async () => {
      const response = await gql<ListData>(
        LIST,
        { filter: { notPlacedInYearId: otherYears.nextYearId, first: 100 } },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.listStudents.totalCount).toBe(0);
      expect(response.data?.listStudents.edges).toEqual([]);
    });

    it('should refuse the filter combined with academicYearId', async () => {
      const response = await gql<ListData>(
        LIST,
        { filter: { notPlacedInYearId: years.nextYearId, academicYearId: years.nextYearId } },
        token,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    });

    it('should not widen a teacher’s restricted view', async () => {
      const { teacher, token: teacherTok } = await teacherToken(inst);
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(sections)
          .set({ classTeacherId: teacher.membershipId })
          .where(eq(sections.id, prevSection5)),
      );

      expect(await listIds({ academicYearId: years.prevYearId }, teacherTok)).toEqual(
        [skipped.profileId, skippedToo.profileId].sort(),
      );
      expect(await listIds({ academicYearId: years.nextYearId }, teacherTok)).toEqual([]);
      expect(await listIds({ notPlacedInYearId: years.nextYearId }, teacherTok)).toEqual([]);
    });

    it('should return nobody once the skipped students are enrolled', async () => {
      for (const student of [skipped, skippedToo]) {
        const response = await gql<{ enrollStudent: string }>(
          ENROLL,
          {
            input: {
              studentProfileId: student.profileId,
              academicYearId: years.nextYearId,
              standardId: next5,
              sectionId: nextSection5,
            },
          },
          token,
        );
        expect(response.errors).toBeUndefined();
      }

      expect(await listIds({ notPlacedInYearId: years.nextYearId }, token)).toEqual([]);
    });
  });

  describe('removeStudentFromYear', () => {
    let inst: TestInstitute;
    let otherInst: TestInstitute;
    let token: string;
    let years: { prevYearId: string; nextYearId: string };
    let prevStandard: string;
    let prevSection: string;
    let nextStandard: string;
    let nextSection: string;
    let otherAcademicId: string;
    let instGroups: Groups;
    let otherGroups: Groups;

    /** Last year in Class 5, this year in Class 6 as the rollover would have placed them. */
    const placedStudent = async () => {
      const student = await addStudent(result.db, inst.tenantId);
      await addAcademic(result.db, inst.tenantId, {
        studentProfileId: student.profileId,
        academicYearId: years.prevYearId,
        standardId: prevStandard,
        sectionId: prevSection,
      });
      const academicId = await addAcademic(result.db, inst.tenantId, {
        studentProfileId: student.profileId,
        academicYearId: years.nextYearId,
        standardId: nextStandard,
        sectionId: nextSection,
      });
      return { ...student, academicId };
    };

    const addAttendance = (student: Student, academicYearId: string, sectionId: string) =>
      withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
        const [session] = await tx
          .insert(attendanceSessions)
          .values({
            ...audit(inst.tenantId),
            sectionId,
            academicYearId,
            date: academicYearId === years.prevYearId ? '2025-07-01' : '2026-07-01',
            lecturerId: inst.membershipId,
          })
          .returning({ id: attendanceSessions.id });
        await tx.insert(attendanceEntries).values({
          ...audit(inst.tenantId),
          sessionId: session.id,
          studentId: student.membershipId,
          status: 'PRESENT',
        });
      });

    const addExamMark = (student: Student) =>
      withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
        const [subject] = await tx
          .insert(subjects)
          .values({ ...audit(inst.tenantId), name: `Maths ${randomUUID().slice(0, 6)}` })
          .returning({ id: subjects.id });
        const [exam] = await tx
          .insert(exams)
          .values({
            ...audit(inst.tenantId),
            academicYearId: years.nextYearId,
            name: { en: `Unit test ${randomUUID().slice(0, 6)}` },
          })
          .returning({ id: exams.id });
        const [schedule] = await tx
          .insert(examSchedules)
          .values({
            ...audit(inst.tenantId),
            examId: exam.id,
            sectionId: nextSection,
            subjectId: subject.id,
            maxMarks: 25,
          })
          .returning({ id: examSchedules.id });
        await tx.insert(examMarks).values({
          ...audit(inst.tenantId),
          examScheduleId: schedule.id,
          studentId: student.membershipId,
          obtainedMarks: 20,
        });
      });

    beforeAll(async () => {
      inst = await createTestInstitute(result.db);
      otherInst = await createTestInstitute(result.db);
      token = tokenFor(inst);
      years = await addYears(result.db, inst.tenantId);
      prevStandard = await addStandard(result.db, inst.tenantId, years.prevYearId, 5);
      prevSection = await addSection(
        result.db,
        inst.tenantId,
        years.prevYearId,
        prevStandard,
        '5-A',
      );
      nextStandard = await addStandard(result.db, inst.tenantId, years.nextYearId, 6);
      nextSection = await addSection(
        result.db,
        inst.tenantId,
        years.nextYearId,
        nextStandard,
        '6-A',
      );

      const otherYears = await addYears(result.db, otherInst.tenantId);
      const otherStandard = await addStandard(
        result.db,
        otherInst.tenantId,
        otherYears.nextYearId,
        6,
      );
      const otherStudent = await addStudent(result.db, otherInst.tenantId);
      otherAcademicId = await addAcademic(result.db, otherInst.tenantId, {
        studentProfileId: otherStudent.profileId,
        academicYearId: otherYears.nextYearId,
        standardId: otherStandard,
        sectionId: await addSection(
          result.db,
          otherInst.tenantId,
          otherYears.nextYearId,
          otherStandard,
          '6-A',
        ),
      });
      instGroups = await addGroups(result.db, inst.tenantId);
      otherGroups = await addGroups(result.db, otherInst.tenantId);
    });

    it('should soft-delete the row, keep the student out on a redelivered rollover, list them as not placed, and allow enrolling again', async () => {
      const student = await placedStudent();
      const before = await rowById(student.academicId);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      const response = await gql<{ removeStudentFromYear: boolean }>(
        REMOVE,
        { id: student.academicId, reason: '  Enrolled by mistake  ' },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.removeStudentFromYear).toBe(true);
      const after = await rowById(student.academicId);
      expect(after).toEqual({
        ...before,
        updatedBy: inst.userId,
        deletedAt: after.deletedAt,
        deletedBy: inst.userId,
        version: before.version + 1,
      });
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(emit.mock.calls).toEqual([
        [
          EVENT_PATTERNS.STUDENT.removed_from_year,
          {
            studentProfileId: student.profileId,
            academicYearId: years.nextYearId,
            sectionId: nextSection,
            reason: 'Enrolled by mistake',
            tenantId: inst.tenantId,
          },
        ],
      ]);

      await withTenant(result.db, mkInstituteCtx(inst.tenantId, ORIGIN), (tx) =>
        rollOverStudents(tx, {
          tenantId: inst.tenantId,
          previousYearId: years.prevYearId,
          academicYearId: years.nextYearId,
          write: true,
        }),
      );
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([]);

      expect(await listIds({ notPlacedInYearId: years.nextYearId }, token)).toEqual([
        student.profileId,
      ]);

      const enrolled = await gql<{ enrollStudent: string }>(
        ENROLL,
        {
          input: {
            studentProfileId: student.profileId,
            academicYearId: years.nextYearId,
            standardId: nextStandard,
            sectionId: nextSection,
          },
        },
        token,
      );
      expect(enrolled.errors).toBeUndefined();
      expect(enrolled.data?.enrollStudent).not.toBe(student.academicId);
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([
        { standardId: nextStandard, sectionId: nextSection },
      ]);
    });

    it('should refuse with STUDENT_YEAR_HAS_RECORDS when the year has an attendance entry or an exam mark', async () => {
      const withAttendance = await placedStudent();
      await addAttendance(withAttendance, years.nextYearId, nextSection);
      const withMark = await placedStudent();
      await addExamMark(withMark);
      const before = await rowsOf(inst.tenantId);
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      for (const student of [withAttendance, withMark]) {
        const response = await gql<{ removeStudentFromYear: boolean }>(
          REMOVE,
          { id: student.academicId, reason: 'Enrolled by mistake' },
          token,
        );
        expect(response.data).toBeNull();
        expect(response.errors?.[0]?.extensions?.code).toBe('STUDENT_YEAR_HAS_RECORDS');
      }

      expect(await rowsOf(inst.tenantId)).toEqual(before);
      expect(emit).not.toHaveBeenCalled();
    });

    it('should not count attendance from another year', async () => {
      const student = await placedStudent();
      await addAttendance(student, years.prevYearId, prevSection);

      const response = await gql<{ removeStudentFromYear: boolean }>(
        REMOVE,
        { id: student.academicId, reason: 'Enrolled by mistake' },
        token,
      );

      expect(response.errors).toBeUndefined();
      expect(await liveRowsIn(student.profileId, years.nextYearId)).toEqual([]);
    });

    it("should refuse another institute's id and a reason shorter than 3 characters", async () => {
      const student = await placedStudent();
      const before = await rowsOf(inst.tenantId);
      const otherBefore = await rowsOf(otherInst.tenantId);

      const foreign = await gql<{ removeStudentFromYear: boolean }>(
        REMOVE,
        { id: otherAcademicId, reason: 'Enrolled by mistake' },
        token,
      );
      expect(foreign.errors?.[0]?.extensions?.code).toBe('STUDENT_ACADEMIC_NOT_FOUND');

      for (const reason of ['ab', '   ab   ']) {
        const short = await gql<{ removeStudentFromYear: boolean }>(
          REMOVE,
          { id: student.academicId, reason },
          token,
        );
        expect(short.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      }

      expect(await rowsOf(inst.tenantId)).toEqual(before);
      expect(await rowsOf(otherInst.tenantId)).toEqual(otherBefore);
    });

    it('should mark only this institute’s dynamic and hybrid groups unresolved', async () => {
      const all = [...Object.values(instGroups), ...Object.values(otherGroups)];
      await markResolved(all);

      await groupHandler.onStudentRemovedFromYear({
        studentProfileId: randomUUID(),
        academicYearId: years.nextYearId,
        sectionId: nextSection,
        reason: 'Enrolled by mistake',
        tenantId: inst.tenantId,
      });

      expect(await resolvedAt(all)).toEqual(
        new Map([
          [instGroups.bySection, 'unresolved'],
          [instGroups.byStandard, 'unresolved'],
          [instGroups.hybrid, 'unresolved'],
          [instGroups.staticGroup, 'resolved'],
          [otherGroups.bySection, 'resolved'],
          [otherGroups.byStandard, 'resolved'],
          [otherGroups.hybrid, 'resolved'],
          [otherGroups.staticGroup, 'resolved'],
        ]),
      );
    });

    it('should refuse a role without update Student', async () => {
      const student = await placedStudent();
      const before = await rowsOf(inst.tenantId);
      const { token: teacher } = await teacherToken(inst);

      const response = await gql<{ removeStudentFromYear: boolean }>(
        REMOVE,
        { id: student.academicId, reason: 'Enrolled by mistake' },
        teacher,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await rowsOf(inst.tenantId)).toEqual(before);
    });
  });
});
