import assert from 'node:assert/strict';
import { AbilityFactory } from '@roviq/casl';
import {
  AddressType,
  DEFAULT_ROLE_ABILITIES,
  type DefaultRole,
  Gender,
  SocialCategory,
  UserDocumentType,
  UserIdentifierType,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  studentProfilesLive,
  userAddresses,
  userDocuments,
  userIdentifiers,
  userProfiles,
  users,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';
import { studentReadPredicate } from '../institute/student/student-read-predicate';

const CTX = 'test:user-groups-security-invariants';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const USER_GROUPS_TABLES = [
  'bot_profiles',
  'consent_records',
  'group_children',
  'group_members',
  'group_rules',
  'groups',
  'guardian_profiles',
  'privacy_notices',
  'staff_profiles',
  'staff_qualifications',
  'student_academics',
  'student_guardian_links',
  'student_profiles',
  'user_addresses',
  'user_documents',
  'user_identifiers',
  'user_profiles',
];

// Keyed by user, not tenant: a row is visible only where its user holds a membership.
const USER_SCOPED_TABLES: { name: string; table: PgTable; userId: PgColumn }[] = [
  { name: 'user_profiles', table: userProfiles, userId: userProfiles.userId },
  { name: 'user_identifiers', table: userIdentifiers, userId: userIdentifiers.userId },
  { name: 'user_documents', table: userDocuments, userId: userDocuments.userId },
  { name: 'user_addresses', table: userAddresses, userId: userAddresses.userId },
];

const PERF_STUDENTS = 2000;
const PERF_BUDGET_MS = 500;
const PERF_CATEGORIES = [SocialCategory.GENERAL, SocialCategory.OBC, SocialCategory.SC];

interface PreviewResponse {
  previewGroupRule: { count: number; sampleMembershipIds: string[] };
}

describe('ROV-205 User & Groups security invariants against PostgreSQL', () => {
  let app: IntegrationAppResult;
  let abilities: AbilityFactory;
  let tenant: TestInstitute;
  let foreignTenant: TestInstitute;
  let perfTenant: TestInstitute;
  let otherReseller: TestReseller;
  const actors: { person: TestTeacher; tenantId: string }[] = [];
  const perfUserIds: string[] = [];
  let teacher: TestTeacher;
  let unassignedTeacher: TestTeacher;
  let student: TestTeacher;
  let otherStudent: TestTeacher;
  let foreignStudent: TestTeacher;
  let ownSectionProfileId: string;
  let otherSectionProfileId: string;
  let foreignProfileId: string;
  let perfRule: Record<string, unknown>;
  let perfExpectedCount: number;

  async function actor(role: DefaultRole, institute: TestInstitute): Promise<TestTeacher> {
    const person = await createTestTeacher(app.db, institute.tenantId);
    await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: DEFAULT_ROLE_ABILITIES[role] })
        .where(eq(roles.id, person.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(eq(memberships.id, person.membershipId));
    });
    actors.push({ person, tenantId: institute.tenantId });
    return person;
  }

  async function createStructure(tx: DrizzleDB, tenantId: string, sectionCount: number) {
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
      .returning();
    const standardRows = await tx
      .insert(standards)
      .values(
        [5, 6].map((numericOrder) => ({
          tenantId,
          academicYearId: year.id,
          name: { en: `Standard ${numericOrder}` },
          numericOrder,
          ...BY,
        })),
      )
      .returning();
    const sectionRows = await tx
      .insert(sections)
      .values(
        Array.from({ length: sectionCount }, (_, index) => ({
          tenantId,
          academicYearId: year.id,
          standardId: standardRows[index % standardRows.length].id,
          name: { en: `Section ${index}` },
          ...BY,
        })),
      )
      .returning();
    return { year, standardRows, sectionRows };
  }

  async function enrol(
    tx: DrizzleDB,
    tenantId: string,
    person: TestTeacher,
    section: typeof sections.$inferSelect,
    admissionNumber: string,
  ): Promise<string> {
    await tx.insert(userProfiles).values({
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
      userId: person.userId,
      firstName: { en: 'Student' },
    });
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: person.userId,
        membershipId: person.membershipId,
        admissionNumber,
        admissionDate: '2026-04-01',
        ...BY,
      })
      .returning();
    await tx.insert(studentAcademics).values({
      tenantId,
      studentProfileId: profile.id,
      academicYearId: section.academicYearId,
      standardId: section.standardId,
      sectionId: section.id,
      ...BY,
    });
    return profile.id;
  }

  async function seedPerfStudents(tx: DrizzleDB) {
    const tenantId = perfTenant.tenantId;
    const { year, standardRows, sectionRows } = await createStructure(tx, tenantId, 4);
    const indexes = Array.from({ length: PERF_STUDENTS }, (_, index) => index);
    const suffix = perfTenant.slug;
    const userRows = await tx
      .insert(users)
      .values(
        indexes.map((index) => ({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          email: `perf_${suffix}_${index}@test.local`,
          username: `perf_${suffix}_${index}`,
          passwordHash: 'not-a-real-hash',
        })),
      )
      .returning({ id: users.id });
    perfUserIds.push(...userRows.map((row) => row.id));
    const membershipRows = await tx
      .insert(memberships)
      .values(
        userRows.map((row) => ({
          userId: row.id,
          roleId: perfTenant.roleId,
          tenantId,
          abilities: [],
          ...BY,
        })),
      )
      .returning({ id: memberships.id, userId: memberships.userId });
    const membershipByUser = new Map(membershipRows.map((row) => [row.userId, row.id]));

    const attributes = indexes.map((index) => ({
      gender: index % 2 === 0 ? Gender.FEMALE : Gender.MALE,
      socialCategory: PERF_CATEGORIES[index % PERF_CATEGORIES.length],
      isMinority: index % 5 === 0,
      section: sectionRows[index % sectionRows.length],
    }));
    await tx.insert(userProfiles).values(
      userRows.map((row, index) => ({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        userId: row.id,
        firstName: { en: `Perf ${index}` },
        gender: attributes[index].gender,
      })),
    );
    const profileRows = await tx
      .insert(studentProfiles)
      .values(
        userRows.map((row, index) => {
          const membershipId = membershipByUser.get(row.id);
          assert(membershipId);
          return {
            tenantId,
            userId: row.id,
            membershipId,
            admissionNumber: `PERF-${index}`,
            admissionDate: '2026-04-01',
            socialCategory: attributes[index].socialCategory,
            isMinority: attributes[index].isMinority,
            ...BY,
          };
        }),
      )
      .returning({ id: studentProfiles.id, userId: studentProfiles.userId });
    const indexByUser = new Map(userRows.map((row, index) => [row.id, index]));
    await tx.insert(studentAcademics).values(
      profileRows.map((profile) => {
        const index = indexByUser.get(profile.userId);
        assert(index !== undefined);
        return {
          tenantId,
          studentProfileId: profile.id,
          academicYearId: year.id,
          standardId: attributes[index].section.standardId,
          sectionId: attributes[index].section.id,
          ...BY,
        };
      }),
    );

    const targetStandard = standardRows[0].id;
    const targetSections = [sectionRows[0].id, sectionRows[3].id];
    perfRule = {
      and: [
        { '==': [{ var: 'gender' }, Gender.FEMALE] },
        { in: [{ var: 'social_category' }, [SocialCategory.OBC, SocialCategory.SC]] },
        { '==': [{ var: 'is_minority' }, false] },
        { '==': [{ var: 'standard_id' }, targetStandard] },
        { in: [{ var: 'section_id' }, targetSections] },
      ],
    };
    perfExpectedCount = attributes.filter(
      (row) =>
        row.gender === Gender.FEMALE &&
        row.socialCategory !== SocialCategory.GENERAL &&
        !row.isMinority &&
        row.section.standardId === targetStandard &&
        targetSections.includes(row.section.id),
    ).length;
  }

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    abilities = app.app.get(AbilityFactory, { strict: false });
    tenant = await createTestInstitute(app.db);
    foreignTenant = await createTestInstitute(app.db);
    perfTenant = await createTestInstitute(app.db);
    otherReseller = await createTestReseller(app.db);
    teacher = await actor('class_teacher', tenant);
    unassignedTeacher = await actor('class_teacher', tenant);
    student = await actor('student', tenant);
    otherStudent = await actor('student', tenant);
    foreignStudent = await actor('student', foreignTenant);

    await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
      const own = await createStructure(tx, tenant.tenantId, 2);
      await tx
        .update(sections)
        .set({ classTeacherId: teacher.membershipId })
        .where(eq(sections.id, own.sectionRows[0].id));
      ownSectionProfileId = await enrol(tx, tenant.tenantId, student, own.sectionRows[0], 'INV-0');
      otherSectionProfileId = await enrol(
        tx,
        tenant.tenantId,
        otherStudent,
        own.sectionRows[1],
        'INV-1',
      );
      const foreign = await createStructure(tx, foreignTenant.tenantId, 1);
      foreignProfileId = await enrol(
        tx,
        foreignTenant.tenantId,
        foreignStudent,
        foreign.sectionRows[0],
        'INV-0',
      );
      const personal = [student.userId, foreignStudent.userId];
      await tx.insert(userIdentifiers).values(
        personal.map((userId) => ({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          userId,
          type: UserIdentifierType.APAAR,
          valuePlain: '123456789012',
        })),
      );
      await tx.insert(userDocuments).values(
        personal.map((userId) => ({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          userId,
          type: UserDocumentType.BIRTH_CERTIFICATE,
        })),
      );
      await tx.insert(userAddresses).values(
        personal.map((userId) => ({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          userId,
          type: AddressType.PERMANENT,
          line1: '12 Test Lane',
          city: 'Jaipur',
          state: 'Rajasthan',
          postalCode: '302001',
        })),
      );
      await seedPerfStudents(tx);
    });
  }, 120_000);

  afterAll(async () => {
    if (!app) return;
    const institutes = [tenant, foreignTenant, perfTenant].filter(Boolean);
    const tenantIds = institutes.map((institute) => institute.tenantId);
    if (tenantIds.length > 0) {
      await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
        await tx.delete(studentAcademics).where(inArray(studentAcademics.tenantId, tenantIds));
        await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
        await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
        await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
        await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
        const userIds = [...perfUserIds, ...actors.map((entry) => entry.person.userId)];
        for (const { table, userId } of USER_SCOPED_TABLES) {
          if (userIds.length > 0) await tx.delete(table).where(inArray(userId, userIds));
        }
      });
    }
    for (const entry of actors.reverse()) await cleanupTestTeacher(app.db, entry.person);
    for (const institute of institutes) await cleanupTestInstitute(app.db, institute);
    if (otherReseller) await cleanupTestReseller(app.db, otherReseller);
    if (perfUserIds.length > 0) {
      await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
        await tx.delete(users).where(inArray(users.id, perfUserIds));
      });
    }
    await app.close();
  }, 120_000);

  /** Student profile ids the person's ability lets them read inside `tenantId`. */
  async function readableStudentIds(
    person: TestTeacher,
    abilityTenantId: string,
    queryTenantId = abilityTenantId,
  ): Promise<string[]> {
    const ability = await abilities.createForUser({
      userId: person.userId,
      scope: 'institute',
      tenantId: abilityTenantId,
      membershipId: person.membershipId,
      roleId: person.roleId,
    });
    const rows = await withTenant(app.db, mkInstituteCtx(queryTenantId, CTX), (tx) =>
      tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(studentReadPredicate(ability, null)),
    );
    return rows.map((row) => row.id);
  }

  it('#2 class_teacher reads 0 students outside the assigned section', async () => {
    const ids = await readableStudentIds(teacher, tenant.tenantId);
    expect(ids).toEqual([ownSectionProfileId]);
    expect(ids).not.toContain(otherSectionProfileId);
  });

  it('#2 class_teacher without an assigned section reads 0 students', async () => {
    expect(await readableStudentIds(unassignedTeacher, tenant.tenantId)).toEqual([]);
  });

  it("#5 student reads 0 rows of another student's data", async () => {
    expect(await readableStudentIds(student, tenant.tenantId)).toEqual([ownSectionProfileId]);
    expect(await readableStudentIds(otherStudent, tenant.tenantId)).toEqual([
      otherSectionProfileId,
    ]);
  });

  it('#18 unrestricted ability still reads 0 rows of another tenant', async () => {
    const ids = await readableStudentIds(tenant, tenant.tenantId);
    expect([...ids].sort()).toEqual([ownSectionProfileId, otherSectionProfileId].sort());
    expect(ids).not.toContain(foreignProfileId);
  });

  it('#18 ability matching a foreign row reads 0 rows from inside another tenant', async () => {
    expect(await readableStudentIds(foreignStudent, foreignTenant.tenantId)).toEqual([
      foreignProfileId,
    ]);
    expect(
      await readableStudentIds(foreignStudent, foreignTenant.tenantId, tenant.tenantId),
    ).toEqual([]);
  });

  it('#19 every User & Groups table has ENABLE + FORCE row level security', async () => {
    const result = await withAdmin(app.db, mkAdminCtx(CTX), (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relkind IN ('r', 'p')
          AND c.relname IN ${USER_GROUPS_TABLES}
        ORDER BY c.relname
      `),
    );
    expect(result.rows).toEqual(
      USER_GROUPS_TABLES.map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })),
    );
  });

  describe.each(USER_SCOPED_TABLES)('$name personal data', ({ table, userId }) => {
    const ownersIn = (tx: DrizzleDB) =>
      tx
        .select({ userId })
        .from(table)
        .where(inArray(userId, [student.userId, foreignStudent.userId]));

    it("institute reads its own member's row and 0 rows of another tenant's user", async () => {
      const rows = await withTenant(app.db, mkInstituteCtx(tenant.tenantId, CTX), ownersIn);
      expect(rows).toEqual([{ userId: student.userId }]);
    });

    it('institute cannot delete a row, even for its own member', async () => {
      const deleted = await withTenant(app.db, mkInstituteCtx(tenant.tenantId, CTX), (tx) =>
        tx.delete(table).where(eq(userId, student.userId)).returning({ userId }),
      );
      expect(deleted).toEqual([]);
    });

    it('reseller reads rows of its own institutes only', async () => {
      const own = await withReseller(app.db, mkResellerCtx(RESELLER_DIRECT_ID, CTX), ownersIn);
      expect(own.map((row) => row.userId).sort()).toEqual(
        [student.userId, foreignStudent.userId].sort(),
      );
      const other = await withReseller(
        app.db,
        mkResellerCtx(otherReseller.resellerId, CTX),
        ownersIn,
      );
      expect(other).toEqual([]);
    });
  });

  it(`resolves a 5-dimension group rule over ${PERF_STUDENTS} students within ${PERF_BUDGET_MS}ms`, async () => {
    const token = createInstituteToken({
      sub: perfTenant.userId,
      tenantId: perfTenant.tenantId,
      membershipId: perfTenant.membershipId,
      roleId: perfTenant.roleId,
    });
    const preview = (rule: Record<string, unknown>) =>
      gqlRequest<PreviewResponse>(app.httpServer, {
        token,
        query:
          'query Preview($rule: JSON!) { previewGroupRule(rule: $rule) { count sampleMembershipIds } }',
        variables: { rule },
      });

    // First request pays one-off GraphQL schema and pool warm-up, not rule evaluation.
    const warmup = await preview({ '==': [{ var: 'is_minority' }, true] });
    expect(warmup.errors).toBeUndefined();
    expect(warmup.data?.previewGroupRule.count).toBe(PERF_STUDENTS / 5);

    const startedAt = performance.now();
    const response = await preview(perfRule);
    const elapsedMs = performance.now() - startedAt;

    expect(response.errors).toBeUndefined();
    expect(perfExpectedCount).toBeGreaterThan(0);
    expect(response.data?.previewGroupRule.count).toBe(perfExpectedCount);
    expect(elapsedMs).toBeLessThan(PERF_BUDGET_MS);
  });
});
