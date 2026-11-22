/**
 * ROV-321 — year-end promotion at rollover, its preview, recording the decision, and the guards
 * on deleting a section with students and enrolling twice. Real PostgreSQL + RLS.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  Gender,
  InstituteType,
  PromotionStatus,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  institutes,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
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
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { StudentEventHandler } from '../student-event.handler';
import { rollOverStudents } from '../year-rollover';

const ORIGIN = 'test:year-end-promotion';

interface StudentSpec {
  key: string;
  order: number;
  promotionStatus?: PromotionStatus;
  promotedToOrder?: number;
  academicStatus?: AcademicStatus;
}

interface YearFixture {
  tenantId: string;
  prevYearId: string;
  nextYearId: string;
  prevStandards: Map<number, string>;
  nextStandards: Map<number, string>;
  prevSections: Map<number, string>;
  nextSections: Map<number, string>;
  students: Map<string, { profileId: string; academicId: string }>;
}

/**
 * Two years for one institute. `nextSectionOrders` lists the next-year levels that get a section;
 * the others get a standard only. The previous year is the active one.
 */
async function createYears(
  db: DrizzleDB,
  tenantId: string,
  opts: {
    prevOrders: number[];
    nextOrders: number[];
    nextSectionOrders: number[];
    students: StudentSpec[];
  },
): Promise<YearFixture> {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const audit = { tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
    const [prevYear, nextYear] = await tx
      .insert(academicYears)
      .values([
        {
          ...audit,
          label: '2025-26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          isActive: true,
          status: 'ACTIVE' as const,
        },
        { ...audit, label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
      ])
      .returning({ id: academicYears.id });

    const makeStandards = async (academicYearId: string, orders: number[]) => {
      const map = new Map<number, string>();
      for (const order of orders) {
        const [row] = await tx
          .insert(standards)
          .values({
            ...audit,
            academicYearId,
            name: { en: `Level ${order}` },
            numericOrder: order,
            level: 'PRIMARY' as const,
          })
          .returning({ id: standards.id });
        map.set(order, row.id);
      }
      return map;
    };
    const prevStandards = await makeStandards(prevYear.id, opts.prevOrders);
    const nextStandards = await makeStandards(nextYear.id, opts.nextOrders);

    const makeSections = async (
      academicYearId: string,
      standardMap: Map<number, string>,
      orders: number[],
    ) => {
      const map = new Map<number, string>();
      for (const order of orders) {
        const standardId = standardMap.get(order);
        if (!standardId) throw new Error(`fixture: no standard at level ${order}`);
        const [row] = await tx
          .insert(sections)
          .values({
            ...audit,
            standardId,
            academicYearId,
            name: { en: `${order}-A` },
            displayLabel: `${order}-A`,
            displayOrder: 1,
            capacity: 40,
          })
          .returning({ id: sections.id });
        map.set(order, row.id);
      }
      return map;
    };
    const prevSections = await makeSections(prevYear.id, prevStandards, opts.prevOrders);
    const nextSections = await makeSections(nextYear.id, nextStandards, opts.nextSectionOrders);

    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student ${randomUUID().slice(0, 8)}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });

    const students = new Map<string, { profileId: string; academicId: string }>();
    for (const spec of opts.students) {
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          email: `promo_${suffix}@test.local`,
          username: `promo_${suffix}`,
          passwordHash: 'not-a-real-hash',
        })
        .returning({ id: users.id });
      await tx.insert(userProfiles).values({
        userId: user.id,
        firstName: { en: `Student ${spec.key}` },
        lastName: { en: 'Verma' },
        gender: Gender.MALE,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });
      const [membership] = await tx
        .insert(memberships)
        .values({ ...audit, userId: user.id, roleId: role.id, abilities: [] })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          ...audit,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `ADM-${suffix}`,
          admissionDate: '2025-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: spec.academicStatus ?? AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
        })
        .returning({ id: studentProfiles.id });
      const standardId = prevStandards.get(spec.order);
      const sectionId = prevSections.get(spec.order);
      if (!standardId || !sectionId) throw new Error(`fixture: no level ${spec.order}`);
      const [academic] = await tx
        .insert(studentAcademics)
        .values({
          ...audit,
          studentProfileId: profile.id,
          academicYearId: prevYear.id,
          standardId,
          sectionId,
          promotionStatus: spec.promotionStatus ?? null,
          promotedToStandardId:
            spec.promotedToOrder === undefined ? null : prevStandards.get(spec.promotedToOrder),
        })
        .returning({ id: studentAcademics.id });
      students.set(spec.key, { profileId: profile.id, academicId: academic.id });
    }

    return {
      tenantId,
      prevYearId: prevYear.id,
      nextYearId: nextYear.id,
      prevStandards,
      nextStandards,
      prevSections,
      nextSections,
      students,
    };
  });
}

function setInstituteType(db: DrizzleDB, tenantId: string, type: InstituteType) {
  return withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
    tx.update(institutes).set({ type }).where(eq(institutes.id, tenantId)),
  );
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture: missing ${what}`);
  return value;
}

describe('Year-end promotion (integration)', () => {
  let result: IntegrationAppResult;
  let handler: StudentEventHandler;
  let schoolInst: TestInstitute;
  let coachingInst: TestInstitute;
  let otherInst: TestInstitute;
  let teacher: TestTeacher;
  let school: YearFixture;
  let coaching: YearFixture;
  let other: YearFixture;
  let schoolToken: string;
  let teacherToken: string;

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  const gql = <T>(query: string, variables: Record<string, unknown>, token: string) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });

  const nextYearRows = (fixture: YearFixture) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          studentProfileId: studentAcademics.studentProfileId,
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
          tenantId: studentAcademics.tenantId,
          createdBy: studentAcademics.createdBy,
          deletedAt: studentAcademics.deletedAt,
        })
        .from(studentAcademics)
        .where(eq(studentAcademics.academicYearId, fixture.nextYearId)),
    );

  const profile = (fixture: YearFixture, key: string) =>
    must(fixture.students.get(key), `student ${key}`).profileId;

  const PREVIEW = `
    query Preview($academicYearId: ID!) {
      academicYearRolloverPreview(academicYearId: $academicYearId) {
        movingUp staying completing notCarried noClassInNewYear alreadyPlaced
      }
    }`;

  type PreviewData = {
    academicYearRolloverPreview: {
      movingUp: number;
      staying: number;
      completing: number;
      notCarried: number;
      noClassInNewYear: number;
      alreadyPlaced: number;
    };
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    handler = result.app.get(StudentEventHandler);
    schoolInst = await createTestInstitute(result.db);
    coachingInst = await createTestInstitute(result.db);
    otherInst = await createTestInstitute(result.db);
    await setInstituteType(result.db, coachingInst.tenantId, InstituteType.COACHING);
    teacher = await createTestTeacher(result.db, schoolInst.tenantId);
    schoolToken = tokenFor(schoolInst);
    teacherToken = createInstituteToken({
      sub: teacher.userId,
      tenantId: schoolInst.tenantId,
      membershipId: teacher.membershipId,
      roleId: teacher.roleId,
    });

    // Level 4 has a standard but no section in the new year; level 6 has no standard at all.
    school = await createYears(result.db, schoolInst.tenantId, {
      prevOrders: [1, 2, 3, 4, 6],
      nextOrders: [1, 2, 3, 4],
      nextSectionOrders: [1, 2, 3],
      students: [
        { key: 'undecided', order: 1 },
        { key: 'pending', order: 1, promotionStatus: PromotionStatus.PENDING },
        { key: 'detained', order: 2, promotionStatus: PromotionStatus.DETAINED },
        {
          key: 'promotedTo3',
          order: 1,
          promotionStatus: PromotionStatus.PROMOTED,
          promotedToOrder: 3,
        },
        { key: 'promotedNoTarget', order: 2, promotionStatus: PromotionStatus.PROMOTED },
        { key: 'noSection', order: 3 },
        { key: 'noStandard', order: 4 },
        { key: 'top', order: 6 },
        { key: 'graduated', order: 6, promotionStatus: PromotionStatus.GRADUATED },
        { key: 'transferred', order: 2, promotionStatus: PromotionStatus.TRANSFERRED },
        { key: 'alreadyPlaced', order: 1 },
        { key: 'left', order: 1, academicStatus: AcademicStatus.TRANSFERRED_OUT },
      ],
    });
    await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(studentAcademics).values({
        tenantId: school.tenantId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        studentProfileId: profile(school, 'alreadyPlaced'),
        academicYearId: school.nextYearId,
        standardId: must(school.nextStandards.get(1), 'next level 1'),
        sectionId: must(school.nextSections.get(1), 'next section 1'),
      }),
    );

    coaching = await createYears(result.db, coachingInst.tenantId, {
      prevOrders: [1, 2],
      nextOrders: [1, 2],
      nextSectionOrders: [1, 2],
      students: [
        { key: 'undecided', order: 1 },
        { key: 'pending', order: 1, promotionStatus: PromotionStatus.PENDING },
        { key: 'promoted', order: 1, promotionStatus: PromotionStatus.PROMOTED },
      ],
    });

    other = await createYears(result.db, otherInst.tenantId, {
      prevOrders: [1, 2],
      nextOrders: [1, 2],
      nextSectionOrders: [1, 2],
      students: [{ key: 'undecided', order: 1 }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    await result?.close();
  });

  describe('academicYearRolloverPreview + ACADEMIC_YEAR.activated', () => {
    const SCHOOL_COUNTS = {
      movingUp: 4,
      staying: 1,
      completing: 1,
      notCarried: 2,
      noClassInNewYear: 2,
      alreadyPlaced: 1,
    };

    it('should count every outcome of the rule and write nothing', async () => {
      const before = await nextYearRows(school);

      const response = await gql<PreviewData>(
        PREVIEW,
        { academicYearId: school.nextYearId },
        schoolToken,
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.academicYearRolloverPreview).toEqual(SCHOOL_COUNTS);
      expect(await nextYearRows(school)).toEqual(before);
      expect(before).toHaveLength(1);
    });

    it('should place students exactly as the preview counted', async () => {
      await handler.onAcademicYearActivated({
        academicYearId: school.nextYearId,
        tenantId: school.tenantId,
        previousYearId: school.prevYearId,
      });

      const rows = await nextYearRows(school);
      const placed = new Map(rows.map((r) => [r.studentProfileId, r]));
      const at = (order: number) => ({
        standardId: must(school.nextStandards.get(order), `next level ${order}`),
        sectionId: must(school.nextSections.get(order), `next section ${order}`),
        tenantId: school.tenantId,
        createdBy: SYSTEM_USER_ID,
        deletedAt: null,
      });
      const expected = [
        ['undecided', 2],
        ['pending', 2],
        ['detained', 2],
        ['promotedTo3', 3],
        ['promotedNoTarget', 3],
      ] as const;
      expect(rows).toHaveLength(expected.length + 1);
      for (const [key, order] of expected) {
        const id = profile(school, key);
        expect(placed.get(id)).toEqual({ studentProfileId: id, ...at(order) });
      }
      const movingUp = expected.filter(([key]) => key !== 'detained').length;
      expect(movingUp).toBe(SCHOOL_COUNTS.movingUp);
      for (const key of ['noSection', 'noStandard', 'top', 'graduated', 'transferred', 'left']) {
        expect(placed.has(profile(school, key))).toBe(false);
      }
      expect(placed.get(profile(school, 'alreadyPlaced'))?.standardId).toBe(
        school.nextStandards.get(1),
      );
    });

    it('should create nothing on a second delivery, and the preview then counts everyone as placed', async () => {
      const before = await nextYearRows(school);

      await handler.onAcademicYearActivated({
        academicYearId: school.nextYearId,
        tenantId: school.tenantId,
        previousYearId: school.prevYearId,
      });

      expect(await nextYearRows(school)).toEqual(before);
      const response = await gql<PreviewData>(
        PREVIEW,
        { academicYearId: school.nextYearId },
        schoolToken,
      );
      expect(response.data?.academicYearRolloverPreview).toEqual({
        movingUp: 0,
        staying: 0,
        completing: 1,
        notCarried: 2,
        noClassInNewYear: 2,
        alreadyPlaced: 6,
      });
    });

    it('should keep an undecided student at the same level in a COACHING institute', async () => {
      const response = await gql<PreviewData>(
        PREVIEW,
        { academicYearId: coaching.nextYearId },
        tokenFor(coachingInst),
      );
      const preview = response.data?.academicYearRolloverPreview;
      expect(preview).toEqual({
        movingUp: 1,
        staying: 2,
        completing: 0,
        notCarried: 0,
        noClassInNewYear: 0,
        alreadyPlaced: 0,
      });

      const counts = await withTenant(result.db, mkInstituteCtx(coaching.tenantId, ORIGIN), (tx) =>
        rollOverStudents(tx, {
          tenantId: coaching.tenantId,
          previousYearId: coaching.prevYearId,
          academicYearId: coaching.nextYearId,
          write: true,
        }),
      );

      expect(counts).toEqual(preview);
      const placed = new Map(
        (await nextYearRows(coaching)).map((r) => [r.studentProfileId, r.standardId]),
      );
      expect(placed).toEqual(
        new Map([
          [profile(coaching, 'undecided'), coaching.nextStandards.get(1)],
          [profile(coaching, 'pending'), coaching.nextStandards.get(1)],
          [profile(coaching, 'promoted'), coaching.nextStandards.get(2)],
        ]),
      );
    });

    it('should move last year’s top class into a class that exists only in the new year', async () => {
      const growing = await createTestInstitute(result.db);
      const fixture = await createYears(result.db, growing.tenantId, {
        prevOrders: [5],
        nextOrders: [5, 6],
        nextSectionOrders: [5, 6],
        students: [{ key: 'top', order: 5 }],
      });

      const counts = await withTenant(result.db, mkInstituteCtx(fixture.tenantId, ORIGIN), (tx) =>
        rollOverStudents(tx, {
          tenantId: fixture.tenantId,
          previousYearId: fixture.prevYearId,
          academicYearId: fixture.nextYearId,
          write: true,
        }),
      );

      expect(counts).toEqual({
        movingUp: 1,
        staying: 0,
        completing: 0,
        notCarried: 0,
        noClassInNewYear: 0,
        alreadyPlaced: 0,
      });
      expect((await nextYearRows(fixture)).map((r) => [r.studentProfileId, r.standardId])).toEqual([
        [profile(fixture, 'top'), fixture.nextStandards.get(6)],
      ]);
    });

    it("should leave another institute's students untouched", async () => {
      expect(await nextYearRows(other)).toEqual([]);
    });

    it("should count nothing and write nothing for one institute's tenant carrying another's year ids", async () => {
      const counts = await withTenant(result.db, mkInstituteCtx(school.tenantId, ORIGIN), (tx) =>
        rollOverStudents(tx, {
          tenantId: school.tenantId,
          previousYearId: other.prevYearId,
          academicYearId: other.nextYearId,
          write: true,
        }),
      );

      expect(counts).toEqual({
        movingUp: 0,
        staying: 0,
        completing: 0,
        notCarried: 0,
        noClassInNewYear: 0,
        alreadyPlaced: 0,
      });
      expect(await nextYearRows(other)).toEqual([]);
    });

    it("should answer ACADEMIC_YEAR_NOT_FOUND for another institute's year", async () => {
      const response = await gql<PreviewData>(
        PREVIEW,
        { academicYearId: other.nextYearId },
        schoolToken,
      );

      expect(response.data).toBeNull();
      expect(response.errors?.[0]?.extensions?.code).toBe('ACADEMIC_YEAR_NOT_FOUND');
    });

    it('should return zeros when the institute has no active year', async () => {
      const lone = await createTestInstitute(result.db);
      const [year] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .insert(academicYears)
          .values({
            tenantId: lone.tenantId,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
            label: '2026-27',
            startDate: '2026-04-01',
            endDate: '2027-03-31',
          })
          .returning({ id: academicYears.id }),
      );

      const response = await gql<PreviewData>(PREVIEW, { academicYearId: year.id }, tokenFor(lone));

      expect(response.data?.academicYearRolloverPreview).toEqual({
        movingUp: 0,
        staying: 0,
        completing: 0,
        notCarried: 0,
        noClassInNewYear: 0,
        alreadyPlaced: 0,
      });
    });

    it('should refuse a role without update AcademicYear', async () => {
      const response = await gql<PreviewData>(
        PREVIEW,
        { academicYearId: school.nextYearId },
        teacherToken,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('setPromotionDecisions', () => {
    const SET = `
      mutation Set($input: SetPromotionDecisionsInput!) { setPromotionDecisions(input: $input) }`;

    const decisionRows = (ids: string[]) =>
      withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({
            id: studentAcademics.id,
            promotionStatus: studentAcademics.promotionStatus,
            promotedToStandardId: studentAcademics.promotedToStandardId,
            updatedBy: studentAcademics.updatedBy,
          })
          .from(studentAcademics)
          .where(inArray(studentAcademics.id, ids))
          .orderBy(studentAcademics.id),
      );

    const academic = (fixture: YearFixture, key: string) =>
      must(fixture.students.get(key), `student ${key}`).academicId;

    it('should keep the explicit target on PROMOTED and clear it on any other status', async () => {
      const promoted = academic(school, 'promotedTo3');
      const detained = academic(school, 'detained');

      const first = await gql<{ setPromotionDecisions: number }>(
        SET,
        { input: { studentAcademicIds: [promoted, detained, promoted], status: 'PROMOTED' } },
        schoolToken,
      );
      expect(first.errors).toBeUndefined();
      expect(first.data?.setPromotionDecisions).toBe(2);
      expect(await decisionRows([promoted])).toEqual([
        {
          id: promoted,
          promotionStatus: PromotionStatus.PROMOTED,
          promotedToStandardId: school.prevStandards.get(3),
          updatedBy: schoolInst.userId,
        },
      ]);

      const second = await gql<{ setPromotionDecisions: number }>(
        SET,
        { input: { studentAcademicIds: [promoted], status: 'DETAINED' } },
        schoolToken,
      );
      expect(second.data?.setPromotionDecisions).toBe(1);
      expect(await decisionRows([promoted])).toEqual([
        {
          id: promoted,
          promotionStatus: PromotionStatus.DETAINED,
          promotedToStandardId: null,
          updatedBy: schoolInst.userId,
        },
      ]);
    });

    it("should refuse another institute's id, alone or mixed with valid ids, and write nothing", async () => {
      const own = academic(school, 'undecided');
      const foreign = academic(other, 'undecided');
      const before = await decisionRows([own, foreign]);

      for (const ids of [[foreign], [own, foreign]]) {
        const response = await gql<{ setPromotionDecisions: number }>(
          SET,
          { input: { studentAcademicIds: ids, status: 'GRADUATED' } },
          schoolToken,
        );
        expect(response.data).toBeNull();
        expect(response.errors?.[0]?.extensions?.code).toBe('STUDENT_ACADEMIC_NOT_FOUND');
      }
      expect(await decisionRows([own, foreign])).toEqual(before);
    });

    it('should refuse TRANSFERRED, which only the transfer certificate flow sets', async () => {
      const own = academic(school, 'undecided');
      const before = await decisionRows([own]);

      const response = await gql<{ setPromotionDecisions: number }>(
        SET,
        { input: { studentAcademicIds: [own], status: 'TRANSFERRED' } },
        schoolToken,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      expect(await decisionRows([own])).toEqual(before);
    });

    it('should refuse an empty list and more than 500 ids', async () => {
      for (const ids of [[], Array.from({ length: 501 }, () => randomUUID())]) {
        const response = await gql<{ setPromotionDecisions: number }>(
          SET,
          { input: { studentAcademicIds: ids, status: 'DETAINED' } },
          schoolToken,
        );
        expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should refuse a role without update Student', async () => {
      const own = academic(school, 'undecided');
      const before = await decisionRows([own]);

      const response = await gql<{ setPromotionDecisions: number }>(
        SET,
        { input: { studentAcademicIds: [own], status: 'DETAINED' } },
        teacherToken,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await decisionRows([own])).toEqual(before);
    });

    it('should return promotionStatus on the students list row', async () => {
      const response = await gql<{
        listStudents: { edges: { node: { id: string; promotionStatus: string | null } }[] };
      }>(
        `query List($filter: StudentFilterInput) {
          listStudents(filter: $filter) { edges { node { id promotionStatus } } }
        }`,
        { filter: { academicYearId: school.prevYearId, first: 50 } },
        schoolToken,
      );

      expect(response.errors).toBeUndefined();
      const byId = new Map(
        response.data?.listStudents.edges.map((e) => [e.node.id, e.node.promotionStatus]),
      );
      expect(byId.get(profile(school, 'promotedTo3'))).toBe(PromotionStatus.DETAINED);
      expect(byId.get(profile(school, 'graduated'))).toBe(PromotionStatus.GRADUATED);
      expect(byId.get(profile(school, 'noSection'))).toBeNull();
    });
  });

  describe('deleteSection', () => {
    const DELETE = `mutation Delete($id: ID!) { deleteSection(id: $id) }`;

    const sectionLive = async (id: string) => {
      const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.select({ deletedAt: sections.deletedAt }).from(sections).where(eq(sections.id, id)),
      );
      return row?.deletedAt === null;
    };

    it('should refuse a section that has students: nothing deleted, no event', async () => {
      const sectionId = must(school.prevSections.get(1), 'prev section 1');
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      const response = await gql<{ deleteSection: boolean }>(
        DELETE,
        { id: sectionId },
        schoolToken,
      );

      expect(response.errors?.[0]?.extensions?.code).toBe('SECTION_HAS_STUDENTS');
      expect(await sectionLive(sectionId)).toBe(true);
      expect(emit).not.toHaveBeenCalledWith(EVENT_PATTERNS.SECTION.deleted, expect.anything());
    });

    it('should delete an empty section', async () => {
      const sectionId = must(school.nextSections.get(3), 'next section 3');
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(studentAcademics)
          .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
          .where(eq(studentAcademics.sectionId, sectionId)),
      );
      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

      const response = await gql<{ deleteSection: boolean }>(
        DELETE,
        { id: sectionId },
        schoolToken,
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.deleteSection).toBe(true);
      expect(await sectionLive(sectionId)).toBe(false);
      expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.SECTION.deleted, {
        sectionId,
        tenantId: school.tenantId,
      });
    });
  });

  describe('enrollStudent', () => {
    const ENROLL = `mutation Enroll($input: EnrollStudentInput!) { enrollStudent(input: $input) }`;

    it('should refuse a second enrolment in the same year, and allow it again once the row is deleted', async () => {
      const studentProfileId = profile(school, 'noSection');
      const input = {
        studentProfileId,
        academicYearId: school.nextYearId,
        standardId: must(school.nextStandards.get(2), 'next level 2'),
        sectionId: must(school.nextSections.get(2), 'next section 2'),
      };

      const first = await gql<{ enrollStudent: string }>(ENROLL, { input }, schoolToken);
      expect(first.errors).toBeUndefined();

      const emit = vi.spyOn(result.app.get(EventBusService), 'emit');
      const second = await gql<{ enrollStudent: string }>(ENROLL, { input }, schoolToken);
      expect(second.errors?.[0]?.extensions?.code).toBe('STUDENT_ALREADY_ENROLLED');
      expect(emit).not.toHaveBeenCalled();
      emit.mockRestore();

      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(studentAcademics)
          .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
          .where(
            and(
              eq(studentAcademics.studentProfileId, studentProfileId),
              eq(studentAcademics.academicYearId, school.nextYearId),
            ),
          ),
      );
      const third = await gql<{ enrollStudent: string }>(ENROLL, { input }, schoolToken);
      expect(third.errors).toBeUndefined();
      expect(third.data?.enrollStudent).not.toBe(first.data?.enrollStudent);
    });
  });

  describe('createStandard numericOrder', () => {
    const CREATE = `
      mutation Create($input: CreateStandardInput!) { createStandard(input: $input) { numericOrder } }`;

    it('should accept a pre-primary level (-3) and refuse one below -5', async () => {
      const ok = await gql<{ createStandard: { numericOrder: number } }>(
        CREATE,
        {
          input: { academicYearId: school.nextYearId, name: { en: 'Nursery' }, numericOrder: -3 },
        },
        schoolToken,
      );
      expect(ok.errors).toBeUndefined();
      expect(ok.data?.createStandard.numericOrder).toBe(-3);

      const refused = await gql<{ createStandard: { numericOrder: number } }>(
        CREATE,
        {
          input: { academicYearId: school.nextYearId, name: { en: 'Too low' }, numericOrder: -6 },
        },
        schoolToken,
      );
      expect(refused.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    });
  });
});
