/**
 * ROV-316 — the gateway's JetStream handlers against real PostgreSQL + RLS, called directly
 * (delivery itself is covered by the e2e suite).
 */
import assert from 'node:assert';
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
  type DrizzleDB,
  groupRules,
  groups,
  memberships,
  mkAdminCtx,
  roles,
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
import {
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { GroupInvalidationHandler } from '../../group/group-invalidation.handler';
import { StudentEventHandler } from '../student-event.handler';

const ORIGIN = 'test:gateway-event-handlers';

interface Fixture {
  tenantId: string;
  prevYearId: string;
  nextYearId: string;
  prev: { class5: string; class6: string; class7: string };
  next: { class5: string; class6: string; class7: string };
  prevSections: { s5: string; s6: string; s7: string };
  nextSections: { s5First: string; s5Second: string; s6: string };
  students: { continuing: string; promoted: string; noSection: string; graduated: string };
  groups: { dynamicSection: string; staticGroup: string };
}

async function createFixture(db: DrizzleDB, tenantId: string): Promise<Fixture> {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const audit = { tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

    const [prevYear, nextYear] = await tx
      .insert(academicYears)
      .values([
        { ...audit, label: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
        { ...audit, label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
      ])
      .returning({ id: academicYears.id });

    const standardRows = async (academicYearId: string) => {
      const rows = await tx
        .insert(standards)
        .values(
          [5, 6, 7].map((order) => ({
            ...audit,
            academicYearId,
            name: { en: `Class ${order}` },
            numericOrder: order,
            level: 'PRIMARY' as const,
          })),
        )
        .returning({ id: standards.id });
      return { class5: rows[0].id, class6: rows[1].id, class7: rows[2].id };
    };
    const prev = await standardRows(prevYear.id);
    const next = await standardRows(nextYear.id);

    const section = async (
      standardId: string,
      academicYearId: string,
      name: string,
      displayOrder: number,
    ) => {
      const [row] = await tx
        .insert(sections)
        .values({
          ...audit,
          standardId,
          academicYearId,
          name: { en: name },
          displayLabel: name,
          displayOrder,
          capacity: 40,
        })
        .returning({ id: sections.id });
      return row.id;
    };
    const prevSections = {
      s5: await section(prev.class5, prevYear.id, '5-A', 1),
      s6: await section(prev.class6, prevYear.id, '6-A', 1),
      s7: await section(prev.class7, prevYear.id, '7-A', 1),
    };
    // Inserted second-first so the rollover has to order by display_order, not insertion.
    const s5Second = await section(next.class5, nextYear.id, '5-B', 2);
    const s5First = await section(next.class5, nextYear.id, '5-A', 1);
    const nextSections = {
      s5First,
      s5Second,
      s6: await section(next.class6, nextYear.id, '6-A', 1),
    };

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

    const student = async (
      academicStatus: AcademicStatus,
      standardId: string,
      sectionId: string,
      promotion?: { promotedToStandardId: string },
    ) => {
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          email: `rollover_${suffix}@test.local`,
          username: `rollover_${suffix}`,
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
      // The institute's own copy: its lists and exports read this, not the account profile.
      await tx.insert(tenantUserProfiles).values({
        ...audit,
        userId: user.id,
        firstName: { en: `Student ${suffix}` },
        lastName: { en: 'Sharma' },
        gender: Gender.FEMALE,
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
          academicStatus,
          socialCategory: SocialCategory.GENERAL,
        })
        .returning({ id: studentProfiles.id });
      await tx.insert(studentAcademics).values({
        ...audit,
        studentProfileId: profile.id,
        academicYearId: prevYear.id,
        standardId,
        sectionId,
        promotionStatus: promotion ? PromotionStatus.PROMOTED : null,
        promotedToStandardId: promotion?.promotedToStandardId ?? null,
      });
      return profile.id;
    };
    const students = {
      continuing: await student(AcademicStatus.ENROLLED, prev.class5, prevSections.s5),
      promoted: await student(AcademicStatus.PROMOTED, prev.class5, prevSections.s5, {
        promotedToStandardId: prev.class6,
      }),
      noSection: await student(AcademicStatus.DETAINED, prev.class7, prevSections.s7),
      graduated: await student(AcademicStatus.GRADUATED, prev.class5, prevSections.s5),
    };

    const [dynamicSection, staticGroup] = await tx
      .insert(groups)
      .values([
        {
          ...audit,
          name: 'Section 5-A students',
          groupType: DomainGroupType.SECTION,
          membershipType: GroupMembershipType.DYNAMIC,
          resolvedAt: new Date(),
        },
        {
          ...audit,
          name: 'Drama club',
          groupType: DomainGroupType.CLUB,
          membershipType: GroupMembershipType.STATIC,
          resolvedAt: new Date(),
        },
      ])
      .returning({ id: groups.id });
    await tx.insert(groupRules).values({
      ...audit,
      groupId: dynamicSection.id,
      rule: { '==': [{ var: 'section_id' }, prevSections.s5] },
      ruleDimensions: ['section_id'],
    });

    return {
      tenantId,
      prevYearId: prevYear.id,
      nextYearId: nextYear.id,
      prev,
      next,
      prevSections,
      nextSections,
      students,
      groups: { dynamicSection: dynamicSection.id, staticGroup: staticGroup.id },
    };
  });
}

describe('Gateway event handlers (integration)', () => {
  let result: IntegrationAppResult;
  let studentHandler: StudentEventHandler;
  let groupHandler: GroupInvalidationHandler;
  let a: Fixture;
  let b: Fixture;

  const yearRows = (fixture: Fixture, academicYearId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          id: studentAcademics.id,
          studentProfileId: studentAcademics.studentProfileId,
          standardId: studentAcademics.standardId,
          sectionId: studentAcademics.sectionId,
          tenantId: studentAcademics.tenantId,
          createdBy: studentAcademics.createdBy,
          updatedBy: studentAcademics.updatedBy,
          deletedAt: studentAcademics.deletedAt,
          deletedBy: studentAcademics.deletedBy,
          updatedAt: studentAcademics.updatedAt,
        })
        .from(studentAcademics)
        .where(
          and(
            eq(studentAcademics.tenantId, fixture.tenantId),
            eq(studentAcademics.academicYearId, academicYearId),
          ),
        ),
    );

  const resolvedAt = async (groupId: string) => {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select({ resolvedAt: groups.resolvedAt }).from(groups).where(eq(groups.id, groupId)),
    );
    assert(row);
    return row.resolvedAt;
  };

  const markResolved = (groupIds: string[]) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.update(groups).set({ resolvedAt: new Date() }).where(inArray(groups.id, groupIds)),
    );

  const softDeleteSection = (sectionId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .update(sections)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(eq(sections.id, sectionId)),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    studentHandler = result.app.get(StudentEventHandler);
    groupHandler = result.app.get(GroupInvalidationHandler);
    a = await createFixture(result.db, (await createTestInstitute(result.db)).tenantId);
    b = await createFixture(result.db, (await createTestInstitute(result.db)).tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('ACADEMIC_YEAR.activated', () => {
    it('should move an undecided student up one level and a promoted one to the promoted standard', async () => {
      await studentHandler.onAcademicYearActivated({
        academicYearId: a.nextYearId,
        tenantId: a.tenantId,
        previousYearId: a.prevYearId,
      });

      const rows = await yearRows(a, a.nextYearId);
      const byStudent = new Map(rows.map((r) => [r.studentProfileId, r]));
      expect(rows).toHaveLength(2);
      expect(byStudent.get(a.students.continuing)).toEqual({
        id: byStudent.get(a.students.continuing)?.id,
        studentProfileId: a.students.continuing,
        standardId: a.next.class6,
        sectionId: a.nextSections.s6,
        tenantId: a.tenantId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        deletedAt: null,
        deletedBy: null,
        updatedAt: byStudent.get(a.students.continuing)?.updatedAt,
      });
      expect(byStudent.get(a.students.promoted)?.standardId).toBe(a.next.class6);
      expect(byStudent.get(a.students.promoted)?.sectionId).toBe(a.nextSections.s6);
      // Class 7 is the top level, so moving up leaves no class; a graduated student does not continue.
      expect(byStudent.has(a.students.noSection)).toBe(false);
      expect(byStudent.has(a.students.graduated)).toBe(false);
    });

    it('should create nothing when the same event is delivered again', async () => {
      const before = await yearRows(a, a.nextYearId);

      await studentHandler.onAcademicYearActivated({
        academicYearId: a.nextYearId,
        tenantId: a.tenantId,
        previousYearId: a.prevYearId,
      });

      expect(await yearRows(a, a.nextYearId)).toEqual(before);
    });

    it("should leave another institute's rows alone", async () => {
      expect(await yearRows(b, b.nextYearId)).toEqual([]);
    });

    it("should create nothing for institute A's tenantId carrying institute B's year ids", async () => {
      await studentHandler.onAcademicYearActivated({
        academicYearId: b.nextYearId,
        tenantId: a.tenantId,
        previousYearId: b.prevYearId,
      });

      expect(await yearRows(b, b.nextYearId)).toEqual([]);
      expect(await yearRows(a, b.nextYearId)).toEqual([]);
    });

    it('should do nothing for a year without a previous year', async () => {
      await studentHandler.onAcademicYearActivated({
        academicYearId: b.nextYearId,
        tenantId: b.tenantId,
        previousYearId: null,
      });

      expect(await yearRows(b, b.nextYearId)).toEqual([]);
    });

    it('should reject a payload that fails its schema', async () => {
      await expect(
        studentHandler.onAcademicYearActivated({
          tenantId: a.tenantId,
          previousAcademicYearId: a.prevYearId,
        }),
      ).rejects.toThrow();
    });

    it('should invalidate every dynamic group of that institute only', async () => {
      await markResolved([a.groups.dynamicSection, a.groups.staticGroup, b.groups.dynamicSection]);

      await groupHandler.onAcademicYearActivated({
        academicYearId: a.nextYearId,
        tenantId: a.tenantId,
        previousYearId: a.prevYearId,
      });

      expect(await resolvedAt(a.groups.dynamicSection)).toBeNull();
      expect(await resolvedAt(a.groups.staticGroup)).toBeInstanceOf(Date);
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });
  });

  describe('SECTION.deleted', () => {
    it("should soft-delete the deleted section's student rows with deleted_by set", async () => {
      await softDeleteSection(a.prevSections.s7);

      await studentHandler.onSectionDeleted({ sectionId: a.prevSections.s7, tenantId: a.tenantId });

      const row = (await yearRows(a, a.prevYearId)).find(
        (r) => r.studentProfileId === a.students.noSection,
      );
      assert(row);
      expect(row.sectionId).toBe(a.prevSections.s7);
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.deletedBy).toBe(SYSTEM_USER_ID);
      expect(row.updatedBy).toBe(SYSTEM_USER_ID);
      expect(row.updatedAt).toEqual(row.deletedAt);
    });

    it('should change nothing on a second delivery', async () => {
      const before = await yearRows(a, a.prevYearId);

      await studentHandler.onSectionDeleted({ sectionId: a.prevSections.s7, tenantId: a.tenantId });

      expect(await yearRows(a, a.prevYearId)).toEqual(before);
    });

    it('should not touch the rows of a section that is still live', async () => {
      const before = await yearRows(a, a.prevYearId);

      await studentHandler.onSectionDeleted({ sectionId: a.prevSections.s5, tenantId: a.tenantId });

      expect(await yearRows(a, a.prevYearId)).toEqual(before);
    });

    it("should not touch another institute's section", async () => {
      await softDeleteSection(b.prevSections.s7);
      const before = await yearRows(b, b.prevYearId);

      await studentHandler.onSectionDeleted({ sectionId: b.prevSections.s7, tenantId: a.tenantId });

      expect(await yearRows(b, b.prevYearId)).toEqual(before);
      expect(before.every((r) => r.deletedAt === null)).toBe(true);
    });

    it('should invalidate section-based groups of that institute only', async () => {
      await markResolved([a.groups.dynamicSection, a.groups.staticGroup, b.groups.dynamicSection]);

      await groupHandler.onSectionDeleted({ sectionId: a.prevSections.s7, tenantId: a.tenantId });

      expect(await resolvedAt(a.groups.dynamicSection)).toBeNull();
      expect(await resolvedAt(a.groups.staticGroup)).toBeInstanceOf(Date);
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });

    it('should not place a student again on redelivery of the rollover after their row was removed', async () => {
      const placed = (await yearRows(a, a.nextYearId)).find(
        (r) => r.studentProfileId === a.students.continuing,
      );
      assert(placed);
      await softDeleteSection(placed.sectionId);
      await studentHandler.onSectionDeleted({ sectionId: placed.sectionId, tenantId: a.tenantId });
      const before = await yearRows(a, a.nextYearId);
      expect(before.find((r) => r.id === placed.id)?.deletedAt).toBeInstanceOf(Date);

      await studentHandler.onAcademicYearActivated({
        academicYearId: a.nextYearId,
        tenantId: a.tenantId,
        previousYearId: a.prevYearId,
      });

      expect(await yearRows(a, a.nextYearId)).toEqual(before);
    });

    it('should leave the student free to be enrolled again in that year, once', async () => {
      const enrol = () =>
        withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
          tx.insert(studentAcademics).values({
            tenantId: a.tenantId,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
            studentProfileId: a.students.noSection,
            academicYearId: a.prevYearId,
            standardId: a.prev.class5,
            sectionId: a.prevSections.s5,
          }),
        );

      await enrol();

      const rows = (await yearRows(a, a.prevYearId)).filter(
        (r) => r.studentProfileId === a.students.noSection,
      );
      expect(rows.map((r) => [r.sectionId, r.deletedAt === null]).sort()).toEqual(
        [
          [a.prevSections.s5, true],
          [a.prevSections.s7, false],
        ].sort(),
      );
      await expect(enrol()).rejects.toThrow();
    });
  });

  describe('group invalidation', () => {
    it('STUDENT.enrolled should invalidate the matching dynamic group and no other institute', async () => {
      await markResolved([a.groups.dynamicSection, a.groups.staticGroup, b.groups.dynamicSection]);

      await groupHandler.onStudentEnrolled({
        studentProfileId: a.students.continuing,
        academicYearId: a.nextYearId,
        sectionId: a.nextSections.s5First,
        tenantId: a.tenantId,
      });

      expect(await resolvedAt(a.groups.dynamicSection)).toBeNull();
      expect(await resolvedAt(a.groups.staticGroup)).toBeInstanceOf(Date);
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });

    it('STUDENT.section_changed should invalidate the matching dynamic group and no other institute', async () => {
      await markResolved([a.groups.dynamicSection, b.groups.dynamicSection]);

      await groupHandler.onStudentSectionChanged({
        studentProfileId: a.students.continuing,
        oldSectionId: a.nextSections.s5First,
        newSectionId: a.nextSections.s5Second,
        tenantId: a.tenantId,
      });

      expect(await resolvedAt(a.groups.dynamicSection)).toBeNull();
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });

    it('GROUP.rules_updated should invalidate only that group', async () => {
      await markResolved([a.groups.dynamicSection, a.groups.staticGroup, b.groups.dynamicSection]);

      await groupHandler.onGroupRulesUpdated({
        groupId: a.groups.staticGroup,
        tenantId: a.tenantId,
      });

      expect(await resolvedAt(a.groups.staticGroup)).toBeNull();
      expect(await resolvedAt(a.groups.dynamicSection)).toBeInstanceOf(Date);
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });

    it("GROUP.rules_updated with another institute's group id should change nothing", async () => {
      await markResolved([b.groups.dynamicSection]);

      await groupHandler.onGroupRulesUpdated({
        groupId: b.groups.dynamicSection,
        tenantId: a.tenantId,
      });

      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });

    it('STUDENT.left should invalidate all dynamic groups of that institute only', async () => {
      await markResolved([a.groups.dynamicSection, a.groups.staticGroup, b.groups.dynamicSection]);

      await groupHandler.onStudentLeft({
        studentProfileId: a.students.graduated,
        reason: AcademicStatus.GRADUATED,
        tcNumber: null,
        tenantId: a.tenantId,
      });

      expect(await resolvedAt(a.groups.dynamicSection)).toBeNull();
      expect(await resolvedAt(a.groups.staticGroup)).toBeInstanceOf(Date);
      expect(await resolvedAt(b.groups.dynamicSection)).toBeInstanceOf(Date);
    });
  });
});
