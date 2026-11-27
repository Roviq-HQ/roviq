/**
 * ROV-323 — section capacity in the rollover preview and the admin's section overrides
 * (`setRolloverSectionMap`, table `year_rollover_section_map`). Real PostgreSQL + RLS.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  PromotionStatus,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  instituteConfigs,
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
  users,
  withAdmin,
  withReseller,
  withTenant,
  yearRolloverSectionMap,
  yearRolloverSectionMapLive,
} from '@roviq/database';
import {
  cleanupTestReseller,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { StudentEventHandler } from '../../student/student-event.handler';

const ORIGIN = 'test:rollover-section-map';

/** Section keys: `p5A` is 5-A of the previous (active) year, `n6C` is 6-C of the next year. */
type SectionKey = 'p5A' | 'p5B' | 'n5A' | 'n5B' | 'n6A' | 'n6B' | 'n6C';

interface Fixture {
  tenantId: string;
  prevYearId: string;
  nextYearId: string;
  nextStandard6: string;
  section: Record<SectionKey, string>;
}

/**
 * Previous year (active): class 5 with 5-A (3 students) and 5-B (2 students and 1 detained).
 * Next year: class 5 with 5-A, 5-B and class 6 with 6-A, 6-B, 6-C.
 */
async function createFixture(db: DrizzleDB, tenantId: string): Promise<Fixture> {
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

    const makeStandard = async (academicYearId: string, order: number) => {
      const [row] = await tx
        .insert(standards)
        .values({
          ...audit,
          academicYearId,
          name: { en: `Class ${order}` },
          numericOrder: order,
          level: 'PRIMARY' as const,
        })
        .returning({ id: standards.id });
      return row.id;
    };
    const prev5 = await makeStandard(prevYear.id, 5);
    const next5 = await makeStandard(nextYear.id, 5);
    const next6 = await makeStandard(nextYear.id, 6);

    const makeSection = async (
      academicYearId: string,
      standardId: string,
      name: string,
      displayOrder: number,
    ) => {
      const [row] = await tx
        .insert(sections)
        .values({ ...audit, standardId, academicYearId, name: { en: name }, displayOrder })
        .returning({ id: sections.id });
      return row.id;
    };
    const section: Record<SectionKey, string> = {
      p5A: await makeSection(prevYear.id, prev5, 'A', 1),
      p5B: await makeSection(prevYear.id, prev5, 'B', 2),
      n5A: await makeSection(nextYear.id, next5, 'A', 1),
      n5B: await makeSection(nextYear.id, next5, 'B', 2),
      n6A: await makeSection(nextYear.id, next6, 'A', 1),
      n6B: await makeSection(nextYear.id, next6, 'B', 2),
      n6C: await makeSection(nextYear.id, next6, 'C', 3),
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

    const addStudent = async (sectionId: string, promotionStatus: PromotionStatus | null) => {
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          email: `rollmap_${suffix}@test.local`,
          username: `rollmap_${suffix}`,
          passwordHash: 'not-a-real-hash',
        })
        .returning({ id: users.id });
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
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
        })
        .returning({ id: studentProfiles.id });
      await tx.insert(studentAcademics).values({
        ...audit,
        studentProfileId: profile.id,
        academicYearId: prevYear.id,
        standardId: prev5,
        sectionId,
        promotionStatus,
      });
    };
    for (let i = 0; i < 3; i++) await addStudent(section.p5A, null);
    for (let i = 0; i < 2; i++) await addStudent(section.p5B, null);
    await addStudent(section.p5B, PromotionStatus.DETAINED);

    return {
      tenantId,
      prevYearId: prevYear.id,
      nextYearId: nextYear.id,
      nextStandard6: next6,
      section,
    };
  });
}

const FIELDS = `
  movingUp staying completing notCarried noClassInNewYear alreadyPlaced
  sections { sectionId standardId standardName sectionName currentStrength incoming capacity }
  moves {
    fromSectionId fromStandardName fromSectionName toStandardId toSectionId students overridden
  }`;

const PREVIEW = `
  query Preview($academicYearId: ID!) {
    academicYearRolloverPreview(academicYearId: $academicYearId) { ${FIELDS} }
  }`;

const SET_MAP = `
  mutation SetMap($input: SetRolloverSectionMapInput!) {
    setRolloverSectionMap(input: $input) { ${FIELDS} }
  }`;

interface Preview {
  movingUp: number;
  staying: number;
  sections: {
    sectionId: string;
    standardId: string;
    standardName: { en: string };
    sectionName: { en: string };
    currentStrength: number;
    incoming: number;
    capacity: number;
  }[];
  moves: {
    fromSectionId: string;
    fromStandardName: { en: string };
    fromSectionName: { en: string };
    toStandardId: string | null;
    toSectionId: string | null;
    students: number;
    overridden: boolean;
  }[];
}

function must<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

describe('Rollover section capacity and overrides (integration)', () => {
  let result: IntegrationAppResult;
  let handler: StudentEventHandler;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let foreignReseller: TestReseller;
  let teacher: TestTeacher;
  let a: Fixture;
  let b: Fixture;
  let tokenA: string;
  let tokenB: string;
  let teacherToken: string;

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  const preview = async (fixture: Fixture, token: string): Promise<Preview> => {
    const res = await gqlRequest<{ academicYearRolloverPreview: Preview }>(result.httpServer, {
      query: PREVIEW,
      variables: { academicYearId: fixture.nextYearId },
      token,
    });
    expect(res.errors).toBeUndefined();
    if (!res.data) throw new Error('no preview');
    return res.data.academicYearRolloverPreview;
  };

  const setMap = (
    academicYearId: string,
    entries: { fromSectionId: string; toSectionId: string | null }[],
    token: string,
  ) =>
    gqlRequest<{ setRolloverSectionMap: Preview }>(result.httpServer, {
      query: SET_MAP,
      variables: { input: { academicYearId, entries } },
      token,
    });

  /** Every map row of both institutes, deleted ones included. */
  const allMapRows = () =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          tenantId: yearRolloverSectionMap.tenantId,
          fromSectionId: yearRolloverSectionMap.fromSectionId,
          toSectionId: yearRolloverSectionMap.toSectionId,
          deletedAt: yearRolloverSectionMap.deletedAt,
          version: yearRolloverSectionMap.version,
        })
        .from(yearRolloverSectionMap)
        .where(
          sql`${yearRolloverSectionMap.tenantId} IN (${a.tenantId}::uuid, ${b.tenantId}::uuid)`,
        ),
    );

  const liveMapRows = async () => (await allMapRows()).filter((r) => r.deletedAt === null);

  const incomingOf = (p: Preview) =>
    Object.fromEntries(p.sections.map((s) => [s.sectionId, s.incoming]));

  const placedPerSection = async (fixture: Fixture) => {
    const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ sectionId: studentAcademics.sectionId })
        .from(studentAcademics)
        .where(
          and(
            eq(studentAcademics.academicYearId, fixture.nextYearId),
            isNull(studentAcademics.deletedAt),
          ),
        ),
    );
    const counts: Record<string, number> = {};
    for (const key of ['n5A', 'n5B', 'n6A', 'n6B', 'n6C'] as const) {
      counts[fixture.section[key]] = 0;
    }
    for (const row of rows) counts[row.sectionId] = (counts[row.sectionId] ?? 0) + 1;
    return counts;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    handler = result.app.get(StudentEventHandler);
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    foreignReseller = await createTestReseller(result.db);
    teacher = await createTestTeacher(result.db, instA.tenantId);
    tokenA = tokenFor(instA);
    tokenB = tokenFor(instB);
    teacherToken = createInstituteToken({
      sub: teacher.userId,
      tenantId: instA.tenantId,
      membershipId: teacher.membershipId,
      roleId: teacher.roleId,
    });
    a = await createFixture(result.db, instA.tenantId);
    b = await createFixture(result.db, instB.tenantId);
    // Institute A allows 2 students per section; institute B has no configuration row.
    await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(instituteConfigs).values({
        tenantId: a.tenantId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        sectionStrengthNorms: { optimal: 2, hardMax: 2, exemptionAllowed: false },
      }),
    );
  });

  afterAll(async () => {
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    if (foreignReseller) await cleanupTestReseller(result.db, foreignReseller);
    await result?.close();
  });

  describe('academicYearRolloverPreview', () => {
    it('should list every section of the new year with its incoming students and hard limit', async () => {
      const p = await preview(a, tokenA);

      expect(p.movingUp).toBe(5);
      expect(p.staying).toBe(1);
      expect(
        p.sections.map((s) => [s.standardName.en, s.sectionId, s.currentStrength, s.incoming]),
      ).toEqual([
        ['Class 5', a.section.n5A, 0, 0],
        ['Class 5', a.section.n5B, 0, 1],
        ['Class 6', a.section.n6A, 0, 3],
        ['Class 6', a.section.n6B, 0, 2],
        ['Class 6', a.section.n6C, 0, 0],
      ]);
      expect(p.sections.every((s) => s.capacity === 2)).toBe(true);
      expect(p.sections.find((s) => s.sectionId === a.section.n6C)?.standardId).toBe(
        a.nextStandard6,
      );
    });

    it('should report a section whose incoming students exceed the hard limit', async () => {
      const p = await preview(a, tokenA);

      const over = p.sections.filter((s) => s.currentStrength + s.incoming > s.capacity);
      expect(over.map((s) => s.sectionId)).toEqual([a.section.n6A]);
    });

    it('should use the default hard limit of 45 when the institute has no norms', async () => {
      const p = await preview(b, tokenB);

      expect(p.sections.map((s) => s.capacity)).toEqual([45, 45, 45, 45, 45]);
    });

    it('should list one move per source and target section, the largest group first', async () => {
      const p = await preview(a, tokenA);

      expect(p.moves).toEqual([
        {
          fromSectionId: a.section.p5A,
          fromStandardName: { en: 'Class 5' },
          fromSectionName: { en: 'A' },
          toStandardId: a.nextStandard6,
          toSectionId: a.section.n6A,
          students: 3,
          overridden: false,
        },
        {
          fromSectionId: a.section.p5B,
          fromStandardName: { en: 'Class 5' },
          fromSectionName: { en: 'B' },
          toStandardId: a.nextStandard6,
          toSectionId: a.section.n6B,
          students: 2,
          overridden: false,
        },
        expect.objectContaining({
          fromSectionId: a.section.p5B,
          toSectionId: a.section.n5B,
          students: 1,
          overridden: false,
        }),
      ]);
    });
  });

  describe('setRolloverSectionMap refusals', () => {
    const refused = async (
      academicYearId: string,
      entries: { fromSectionId: string; toSectionId: string | null }[],
      token: string,
      code: string,
    ) => {
      const before = await allMapRows();
      const res = await setMap(academicYearId, entries, token);
      expect(res.errors?.[0]?.extensions?.code).toBe(code);
      expect(await allMapRows()).toEqual(before);
    };

    it("should refuse another institute's target section and store nothing", async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: b.section.n6C }],
        tokenA,
        'SECTION_NOT_FOUND',
      );
      expect(await allMapRows()).toEqual([]);
    });

    it("should refuse another institute's source section and store nothing", async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: b.section.p5B, toSectionId: a.section.n6C }],
        tokenA,
        'SECTION_NOT_FOUND',
      );
    });

    it("should refuse another institute's source section when removing an override", async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: b.section.p5B, toSectionId: null }],
        tokenA,
        'SECTION_NOT_FOUND',
      );
    });

    it("should refuse another institute's academic year and store nothing", async () => {
      await refused(
        b.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6C }],
        tokenA,
        'ACADEMIC_YEAR_NOT_FOUND',
      );
    });

    it('should refuse a target section that is not in the target year', async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.p5A }],
        tokenA,
        'SECTION_NOT_FOUND',
      );
    });

    it('should refuse a source section that is not in the active year', async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: a.section.n5B, toSectionId: a.section.n6C }],
        tokenA,
        'SECTION_NOT_FOUND',
      );
    });

    it('should refuse the whole request when one entry of several is wrong', async () => {
      await refused(
        a.nextYearId,
        [
          { fromSectionId: a.section.p5A, toSectionId: a.section.n6C },
          { fromSectionId: a.section.p5B, toSectionId: b.section.n6C },
        ],
        tokenA,
        'SECTION_NOT_FOUND',
      );
    });

    it('should refuse the active year as the target with YEAR_ALREADY_ACTIVE', async () => {
      await refused(
        a.prevYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6C }],
        tokenA,
        'YEAR_ALREADY_ACTIVE',
      );
    });

    it('should refuse the same source section twice in one request', async () => {
      const before = await allMapRows();
      const res = await setMap(
        a.nextYearId,
        [
          { fromSectionId: a.section.p5B, toSectionId: a.section.n6C },
          { fromSectionId: a.section.p5B, toSectionId: a.section.n6A },
        ],
        tokenA,
      );
      expect(res.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      expect(await allMapRows()).toEqual(before);
    });

    it('should refuse a role without update on AcademicYear', async () => {
      await refused(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6C }],
        teacherToken,
        'FORBIDDEN',
      );
    });
  });

  describe('setRolloverSectionMap', () => {
    it('should send 5-B to 6-C, and leave the detained student on the name rule', async () => {
      const res = await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6C }],
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      const p = res.data?.setRolloverSectionMap;
      if (!p) throw new Error('no preview');
      expect(incomingOf(p)).toEqual({
        [a.section.n5A]: 0,
        [a.section.n5B]: 1,
        [a.section.n6A]: 3,
        [a.section.n6B]: 0,
        [a.section.n6C]: 2,
      });
      expect(
        p.moves
          .filter((m) => m.fromSectionId === a.section.p5B)
          .map((m) => [m.toSectionId, m.students, m.overridden]),
      ).toEqual([
        [a.section.n6C, 2, true],
        [a.section.n5B, 1, false],
      ]);
      expect(await liveMapRows()).toEqual([
        expect.objectContaining({
          tenantId: a.tenantId,
          fromSectionId: a.section.p5B,
          toSectionId: a.section.n6C,
          version: 1,
        }),
      ]);
      // Institute B set nothing: its 5-B still goes to the section of the same name.
      expect(incomingOf(await preview(b, tokenB))[b.section.n6B]).toBe(2);
    });

    it('should replace the override of a section in place', async () => {
      const res = await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6A }],
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      expect(await allMapRows()).toEqual([
        expect.objectContaining({ toSectionId: a.section.n6A, deletedAt: null, version: 2 }),
      ]);
      expect(incomingOf(await preview(a, tokenA))[a.section.n6A]).toBe(5);
    });

    it('should remove an override with a null target and fall back to the name rule', async () => {
      const res = await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: null }],
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      expect(await liveMapRows()).toEqual([]);
      expect(incomingOf(await preview(a, tokenA))[a.section.n6B]).toBe(2);
    });

    it('should not apply an override to a class the students do not go to', async () => {
      await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5A, toSectionId: a.section.n5A }],
        tokenA,
      );
      // 5-A's students go to class 6, so an override to a class 5 section does not apply.
      const p = await preview(a, tokenA);
      expect(incomingOf(p)[a.section.n5A]).toBe(0);
      expect(incomingOf(p)[a.section.n6A]).toBe(3);
      await setMap(a.nextYearId, [{ fromSectionId: a.section.p5A, toSectionId: null }], tokenA);
    });

    it('should ignore an override whose target section was deleted', async () => {
      const audit = { tenantId: a.tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
      const [extra] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .insert(sections)
          .values({
            ...audit,
            standardId: a.nextStandard6,
            academicYearId: a.nextYearId,
            name: { en: 'D' },
            displayOrder: 4,
          })
          .returning({ id: sections.id }),
      );
      const set = await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5A, toSectionId: extra.id }],
        tokenA,
      );
      expect(incomingOf(must(set.data?.setRolloverSectionMap))[extra.id]).toBe(3);

      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(sections)
          .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
          .where(eq(sections.id, extra.id)),
      );

      const p = await preview(a, tokenA);
      expect(p.sections.map((s) => s.sectionId)).not.toContain(extra.id);
      expect(incomingOf(p)[a.section.n6A]).toBe(3);
      await setMap(a.nextYearId, [{ fromSectionId: a.section.p5A, toSectionId: null }], tokenA);
    });
  });

  describe('year_rollover_section_map database rules', () => {
    beforeAll(async () => {
      const res = await setMap(
        a.nextYearId,
        [{ fromSectionId: a.section.p5B, toSectionId: a.section.n6C }],
        tokenA,
      );
      expect(res.errors).toBeUndefined();
    });

    const asTenant = <T>(tenantId: string, fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(result.db, mkInstituteCtx(tenantId, ORIGIN), fn);

    const row = (tenantId: string, fixture: Fixture, from: string, to: string) => ({
      tenantId,
      academicYearId: fixture.nextYearId,
      fromSectionId: from,
      toSectionId: to,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    it('should have a policy for roviq_app, roviq_reseller and roviq_admin, with RLS forced', async () => {
      const policies = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.execute<{ policyname: string; roles: string }>(sql`
          SELECT policyname, roles::text AS roles FROM pg_policies
          WHERE tablename = 'year_rollover_section_map' ORDER BY policyname`),
      );
      expect(policies.rows).toEqual([
        { policyname: 'year_rollover_section_map_admin_all', roles: '{roviq_admin}' },
        { policyname: 'year_rollover_section_map_app_delete', roles: '{roviq_app}' },
        { policyname: 'year_rollover_section_map_app_insert', roles: '{roviq_app}' },
        { policyname: 'year_rollover_section_map_app_select', roles: '{roviq_app}' },
        { policyname: 'year_rollover_section_map_app_update', roles: '{roviq_app}' },
        { policyname: 'year_rollover_section_map_reseller_read', roles: '{roviq_reseller}' },
      ]);
      const forced = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.execute<{ forced: boolean }>(sql`
          SELECT relforcerowsecurity AS forced FROM pg_class
          WHERE relname = 'year_rollover_section_map'`),
      );
      expect(forced.rows).toEqual([{ forced: true }]);
    });

    it("should hide institute A's rows from institute B, in the table and the live view", async () => {
      const own = await asTenant(a.tenantId, (tx) =>
        tx.select({ id: yearRolloverSectionMapLive.id }).from(yearRolloverSectionMapLive),
      );
      const fromView = await asTenant(b.tenantId, (tx) =>
        tx.select({ id: yearRolloverSectionMapLive.id }).from(yearRolloverSectionMapLive),
      );
      const fromTable = await asTenant(b.tenantId, (tx) =>
        // allow-base-read: the RLS policy of the base table is what is under test
        tx.select({ id: yearRolloverSectionMap.id }).from(yearRolloverSectionMap),
      );

      expect(own).toHaveLength(1);
      expect(fromView).toEqual([]);
      expect(fromTable).toEqual([]);
    });

    it('should not let institute B change or hard-delete a row of institute A', async () => {
      const updated = await asTenant(b.tenantId, (tx) =>
        tx
          .update(yearRolloverSectionMap)
          .set({ toSectionId: b.section.n6A })
          .where(eq(yearRolloverSectionMap.tenantId, a.tenantId))
          .returning({ id: yearRolloverSectionMap.id }),
      );
      await expect(
        asTenant(a.tenantId, (tx) =>
          tx.delete(yearRolloverSectionMap).returning({ id: yearRolloverSectionMap.id }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      expect(updated).toEqual([]);
      expect(await liveMapRows()).toHaveLength(1);
    });

    it('should not let institute B insert a row for institute A', async () => {
      await expect(
        asTenant(b.tenantId, (tx) =>
          tx
            .insert(yearRolloverSectionMap)
            .values(row(a.tenantId, a, a.section.p5A, a.section.n6C)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('should hide the rows from a reseller that does not own the institute', async () => {
      const rows = await withReseller(
        result.db,
        mkResellerCtx(foreignReseller.resellerId, ORIGIN),
        (tx) => tx.select({ id: yearRolloverSectionMapLive.id }).from(yearRolloverSectionMapLive),
      );

      expect(rows).toEqual([]);
    });

    it("should refuse, by trigger, a row that names another institute's target section", async () => {
      await expect(
        asTenant(a.tenantId, (tx) =>
          tx
            .insert(yearRolloverSectionMap)
            .values(row(a.tenantId, a, a.section.p5A, b.section.n6C)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it("should refuse, by trigger, a row that names another institute's source section", async () => {
      await expect(
        withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
          tx
            .insert(yearRolloverSectionMap)
            .values(row(a.tenantId, a, b.section.p5A, a.section.n6C)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('should refuse, by trigger, a target section of another year, on insert and on update', async () => {
      await expect(
        asTenant(a.tenantId, (tx) =>
          tx
            .insert(yearRolloverSectionMap)
            .values(row(a.tenantId, a, a.section.p5A, a.section.p5B)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      await expect(
        asTenant(a.tenantId, (tx) =>
          tx
            .update(yearRolloverSectionMap)
            .set({ toSectionId: b.section.n6C })
            .where(eq(yearRolloverSectionMap.fromSectionId, a.section.p5B)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });

  // Last: it places the students, which changes what every preview above counts.
  describe('ACADEMIC_YEAR.activated', () => {
    it('should place the students where the preview said, with the override', async () => {
      const expected = incomingOf(await preview(a, tokenA));

      await handler.onAcademicYearActivated({
        tenantId: a.tenantId,
        academicYearId: a.nextYearId,
        previousYearId: a.prevYearId,
      });

      const placed = await placedPerSection(a);
      expect(placed).toEqual(expected);
      expect(placed).toEqual({
        [a.section.n5A]: 0,
        [a.section.n5B]: 1,
        [a.section.n6A]: 3,
        [a.section.n6B]: 0,
        [a.section.n6C]: 2,
      });
    });

    it('should send 5-B to the section of the same name when there is no override', async () => {
      const expected = incomingOf(await preview(b, tokenB));

      await handler.onAcademicYearActivated({
        tenantId: b.tenantId,
        academicYearId: b.nextYearId,
        previousYearId: b.prevYearId,
      });

      const placed = await placedPerSection(b);
      expect(placed).toEqual(expected);
      expect(placed[b.section.n6B]).toBe(2);
      expect(placed[b.section.n6C]).toBe(0);
    });

    it('should place a student in a section that is over its hard limit', async () => {
      const p = await preview(a, tokenA);

      const n6A = p.sections.find((s) => s.sectionId === a.section.n6A);
      expect(n6A).toMatchObject({ currentStrength: 3, incoming: 0, capacity: 2 });
    });
  });
});
