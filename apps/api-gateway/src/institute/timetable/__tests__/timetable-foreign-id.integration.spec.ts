/**
 * ROV-293: every timetable operation that takes an id refuses a timetable, period, override,
 * academic year, section, subject or teacher of another institute, returns none of its data,
 * and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  files,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
  staffProfiles,
  standards,
  subjects,
  tenantUserProfiles,
  timetableDayOverrides,
  timetableEntries,
  timetablePeriods,
  timetableSections,
  timetables,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { TimetableDrizzleRepository } from '../repositories/timetable.drizzle-repository';
import { TimetableViewService } from '../timetable-view.service';

const ORIGIN = 'test:timetable-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const ALL_DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
/** A Monday inside the timetables' effective range. */
const MONDAY = '2026-12-07';

const TIMETABLE = /* GraphQL */ `
  query Timetable($id: ID!) {
    timetable(id: $id) {
      id
    }
  }
`;
const TIMETABLES = /* GraphQL */ `
  query Timetables($academicYearId: ID, $sectionId: ID) {
    timetables(academicYearId: $academicYearId, sectionId: $sectionId) {
      total
      docs {
        id
      }
    }
  }
`;
const STATISTICS = /* GraphQL */ `
  query TimetableStatistics($academicYearId: ID) {
    timetableStatistics(academicYearId: $academicYearId) {
      total
      draft
      active
      inactive
      archived
    }
  }
`;
const SECTION_GRID = /* GraphQL */ `
  query SectionTimetable($sectionId: ID!, $timetableId: ID) {
    sectionTimetable(sectionId: $sectionId, timetableId: $timetableId) {
      timetableId
      entries {
        id
      }
    }
  }
`;
const STAFF_GRID = /* GraphQL */ `
  query StaffTimetable($teacherId: ID!, $timetableId: ID) {
    staffTimetable(teacherId: $teacherId, timetableId: $timetableId) {
      timetableId
      teacherName
      entries {
        id
      }
    }
  }
`;
const SECTION_PDF = /* GraphQL */ `
  query SectionTimetablePdf($sectionId: ID!, $timetableId: ID) {
    sectionTimetablePdf(sectionId: $sectionId, timetableId: $timetableId)
  }
`;
const STAFF_PDF = /* GraphQL */ `
  query StaffTimetablePdf($teacherId: ID!, $timetableId: ID) {
    staffTimetablePdf(teacherId: $teacherId, timetableId: $timetableId)
  }
`;
const DAY_SCHEDULE = /* GraphQL */ `
  query TimetableDaySchedule($sectionId: ID!) {
    timetableDaySchedule(date: "2026-12-07", sectionId: $sectionId) {
      timetableId
      slots {
        periodId
        subjectId
        teacherId
        isOverride
      }
    }
  }
`;
const STAFF_DAY = /* GraphQL */ `
  query StaffDaySchedule($teacherId: ID!) {
    staffDaySchedule(date: "2026-12-07", teacherId: $teacherId) {
      periodId
      sectionId
    }
  }
`;
const OVERRIDES = /* GraphQL */ `
  query TimetableDayOverrides($timetableId: ID!) {
    timetableDayOverrides(timetableId: $timetableId, date: "2026-12-07") {
      id
    }
  }
`;
const CREATE = /* GraphQL */ `
  mutation CreateTimetable($academicYearId: ID, $sectionIds: [ID!]!, $name: I18nText!) {
    createTimetable(
      input: {
        academicYearId: $academicYearId
        name: $name
        effectiveFrom: "2026-11-01"
        effectiveTo: "2027-02-28"
        workingDays: ["MONDAY", "TUESDAY"]
        dayStartTime: "08:00"
        defaultPeriodDurationMins: 40
        periodsCount: 2
        sectionIds: $sectionIds
        lunch: []
        extraClass: []
      }
    ) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateTimetable($id: ID!) {
    updateTimetable(id: $id, input: { description: "Renamed" }) {
      id
    }
  }
`;
const status = (operation: string) => /* GraphQL */ `
  mutation Status($id: ID!) {
    ${operation}(id: $id) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteTimetable($ids: [ID!]!) {
    deleteTimetable(ids: $ids)
  }
`;
const RESTORE = /* GraphQL */ `
  mutation RestoreTimetable($ids: [ID!]!) {
    restoreTimetable(ids: $ids)
  }
`;
const ADD_SECTION = /* GraphQL */ `
  mutation AddTimetableSection($timetableId: ID!, $sectionId: ID!) {
    addTimetableSection(timetableId: $timetableId, sectionId: $sectionId) {
      id
    }
  }
`;
const REMOVE_SECTION = /* GraphQL */ `
  mutation RemoveTimetableSection($timetableId: ID!, $sectionId: ID!) {
    removeTimetableSection(timetableId: $timetableId, sectionId: $sectionId)
  }
`;
const ADD_PERIOD = /* GraphQL */ `
  mutation AddTimetablePeriod($timetableId: ID!) {
    addTimetablePeriod(input: { timetableId: $timetableId, kind: "PERIOD" }) {
      id
    }
  }
`;
const UPDATE_PERIOD = /* GraphQL */ `
  mutation UpdateTimetablePeriod($timetableId: ID!, $periodId: ID!) {
    updateTimetablePeriod(timetableId: $timetableId, periodId: $periodId, input: { label: "Zero" }) {
      id
    }
  }
`;
const REMOVE_PERIOD = /* GraphQL */ `
  mutation RemoveTimetablePeriod($timetableId: ID!, $periodId: ID!) {
    removeTimetablePeriod(timetableId: $timetableId, periodId: $periodId)
  }
`;
const ASSIGN = /* GraphQL */ `
  mutation AssignTimetableEntry($input: AssignTimetableEntryInput!) {
    assignTimetableEntry(input: $input) {
      id
    }
  }
`;
const CLEAR = /* GraphQL */ `
  mutation ClearTimetableEntry($input: ClearTimetableEntryInput!) {
    clearTimetableEntry(input: $input)
  }
`;
const CREATE_OVERRIDE = /* GraphQL */ `
  mutation CreateTimetableDayOverride($input: CreateTimetableDayOverrideInput!) {
    createTimetableDayOverride(input: $input) {
      id
    }
  }
`;
const CLEAR_OVERRIDE = /* GraphQL */ `
  mutation ClearTimetableDayOverride($id: ID!) {
    clearTimetableDayOverride(id: $id)
  }
`;

interface Fixture {
  yearId: string;
  sectionId: string;
  otherSectionId: string;
  subjectId: string;
  /** A teacher with a staff profile, the teacher of the active timetable's entry. */
  teacherId: string;
  /** The substitute named by the override. */
  otherTeacherId: string;
  /** ACTIVE, covers `sectionId`, with one period, one Monday entry and one override. */
  timetableId: string;
  periodId: string;
  entryId: string;
  overrideId: string;
  /** DRAFT, covers `sectionId`, with one period: the target of the own cases. */
  draftTimetableId: string;
  draftPeriodId: string;
  /** DRAFT, nothing else. */
  spareTimetableId: string;
  /** Soft-deleted. */
  deletedTimetableId: string;
}

describe('timetable: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Timetable rows and files of both institutes, and every timetable row pointing at B's. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignTimetables = [
        b.timetableId,
        b.draftTimetableId,
        b.spareTimetableId,
        b.deletedTimetableId,
      ];
      const foreignSections = [b.sectionId, b.otherSectionId];
      const foreignPeriods = [b.periodId, b.draftPeriodId];
      const foreignTeachers = [b.teacherId, b.otherTeacherId];
      return {
        timetables: await tx
          .select()
          .from(timetables)
          .where(or(inArray(timetables.tenantId, tenants), eq(timetables.academicYearId, b.yearId)))
          .orderBy(asc(timetables.id)),
        sections: await tx
          .select()
          .from(timetableSections)
          .where(
            or(
              inArray(timetableSections.tenantId, tenants),
              inArray(timetableSections.timetableId, foreignTimetables),
              inArray(timetableSections.sectionId, foreignSections),
            ),
          )
          .orderBy(asc(timetableSections.id)),
        periods: await tx
          .select()
          .from(timetablePeriods)
          .where(
            or(
              inArray(timetablePeriods.tenantId, tenants),
              inArray(timetablePeriods.timetableId, foreignTimetables),
            ),
          )
          .orderBy(asc(timetablePeriods.id)),
        entries: await tx
          .select()
          .from(timetableEntries)
          .where(
            or(
              inArray(timetableEntries.tenantId, tenants),
              inArray(timetableEntries.timetableId, foreignTimetables),
              inArray(timetableEntries.sectionId, foreignSections),
              inArray(timetableEntries.periodId, foreignPeriods),
              eq(timetableEntries.subjectId, b.subjectId),
              inArray(timetableEntries.teacherId, foreignTeachers),
            ),
          )
          .orderBy(asc(timetableEntries.id)),
        overrides: await tx
          .select()
          .from(timetableDayOverrides)
          .where(
            or(
              inArray(timetableDayOverrides.tenantId, tenants),
              inArray(timetableDayOverrides.timetableId, foreignTimetables),
              inArray(timetableDayOverrides.sectionId, foreignSections),
              inArray(timetableDayOverrides.periodId, foreignPeriods),
              eq(timetableDayOverrides.subjectId, b.subjectId),
              inArray(timetableDayOverrides.teacherId, foreignTeachers),
            ),
          )
          .orderBy(asc(timetableDayOverrides.id)),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.tenantId, tenants),
              inArray(files.uploadedBy, [instA.userId, instB.userId]),
            ),
          )
          .orderBy(asc(files.id)),
      };
    });

  const setUp = async (inst: TestInstitute): Promise<Fixture> => {
    const teacher = await createTestTeacher(result.db, inst.tenantId);
    const otherTeacher = await createTestTeacher(result.db, inst.tenantId);
    return asAdmin(async (tx) => {
      const tenantId = inst.tenantId;
      await tx.insert(userProfiles).values({
        userId: teacher.userId,
        firstName: { en: 'Meera' },
        lastName: { en: 'Rao' },
        ...BY,
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId,
        userId: teacher.userId,
        firstName: { en: 'Meera' },
        lastName: { en: 'Rao' },
        ...BY,
      });
      await tx.insert(staffProfiles).values({
        tenantId,
        userId: teacher.userId,
        membershipId: teacher.membershipId,
        employeeId: `EMP-${randomUUID().slice(0, 8)}`,
        designation: 'Teacher',
        dateOfJoining: '2025-06-01',
        ...BY,
      });
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
      const [section, otherSection] = await tx
        .insert(sections)
        .values(
          ['A', 'B'].map((name) => ({
            tenantId,
            standardId: standard.id,
            academicYearId: year.id,
            name: { en: name },
            displayLabel: `Class 5-${name}`,
            capacity: 40,
            ...BY,
          })),
        )
        .returning({ id: sections.id });
      const [subject] = await tx
        .insert(subjects)
        .values({ tenantId, name: 'Mathematics', ...BY })
        .returning({ id: subjects.id });
      const addTimetable = async (
        name: string,
        timetableStatus: 'ACTIVE' | 'DRAFT',
        deletedAt: Date | null = null,
      ) => {
        const [row] = await tx
          .insert(timetables)
          .values({
            tenantId,
            academicYearId: year.id,
            name: { en: name },
            status: timetableStatus,
            effectiveFrom: '2026-04-01',
            effectiveTo: '2027-03-31',
            workingDays: [...ALL_DAYS],
            dayStartTime: '08:00',
            defaultPeriodDurationMins: 40,
            deletedAt,
            deletedBy: deletedAt ? SYSTEM_USER_ID : null,
            ...BY,
          })
          .returning({ id: timetables.id });
        return row.id;
      };
      const addPeriod = async (timetableId: string) => {
        await tx
          .insert(timetableSections)
          .values({ tenantId, timetableId, sectionId: section.id, ...BY });
        const [row] = await tx
          .insert(timetablePeriods)
          .values({
            tenantId,
            timetableId,
            kind: 'PERIOD',
            label: '1',
            sequence: 1,
            startTime: '08:00',
            endTime: '08:40',
            ...BY,
          })
          .returning({ id: timetablePeriods.id });
        return row.id;
      };

      const timetableId = await addTimetable('Main', 'ACTIVE');
      const periodId = await addPeriod(timetableId);
      const [entry] = await tx
        .insert(timetableEntries)
        .values({
          tenantId,
          timetableId,
          periodId,
          sectionId: section.id,
          dayOfWeek: 'MONDAY',
          subjectId: subject.id,
          teacherId: teacher.membershipId,
          room: '101',
          ...BY,
        })
        .returning({ id: timetableEntries.id });
      const [override] = await tx
        .insert(timetableDayOverrides)
        .values({
          tenantId,
          timetableId,
          date: MONDAY,
          sectionId: section.id,
          periodId,
          overrideType: 'SUBSTITUTION',
          subjectId: subject.id,
          teacherId: otherTeacher.membershipId,
          ...BY,
        })
        .returning({ id: timetableDayOverrides.id });
      const draftTimetableId = await addTimetable('Draft', 'DRAFT');
      return {
        yearId: year.id,
        sectionId: section.id,
        otherSectionId: otherSection.id,
        subjectId: subject.id,
        teacherId: teacher.membershipId,
        otherTeacherId: otherTeacher.membershipId,
        timetableId,
        periodId,
        entryId: entry.id,
        overrideId: override.id,
        draftTimetableId,
        draftPeriodId: await addPeriod(draftTimetableId),
        spareTimetableId: await addTimetable('Spare', 'DRAFT'),
        deletedTimetableId: await addTimetable('Old', 'DRAFT', new Date()),
      };
    });
  };

  const query = async <T>(source: string, variables: Record<string, unknown>) => {
    const res = await gqlRequest<T>(result.httpServer, { query: source, variables, token: tokenA });
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, { query: source, variables, token: tokenA });

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

  describe('reads', () => {
    it('timetable should refuse a timetable of another institute and return none of it', async () => {
      const res = await gqlRequest(result.httpServer, {
        query: TIMETABLE,
        variables: { id: b.timetableId },
        token: tokenA,
      });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.TIMETABLE_NOT_FOUND);
      expect(res.data).toBeNull();
    });

    it('timetables should list its own year and section and nothing of another institute', async () => {
      const ids = (data: { timetables: { docs: { id: string }[] } } | undefined) =>
        data?.timetables.docs.map((doc) => doc.id).sort();
      type Page = { timetables: { total: number; docs: { id: string }[] } };

      expect(ids(await query<Page>(TIMETABLES, { academicYearId: a.yearId }))).toEqual(
        [a.timetableId, a.draftTimetableId, a.spareTimetableId].sort(),
      );
      expect(ids(await query<Page>(TIMETABLES, { sectionId: a.sectionId }))).toEqual(
        [a.timetableId, a.draftTimetableId].sort(),
      );
      expect(await query(TIMETABLES, { academicYearId: b.yearId })).toEqual({
        timetables: { total: 0, docs: [] },
      });
      expect(await query(TIMETABLES, { sectionId: b.sectionId })).toEqual({
        timetables: { total: 0, docs: [] },
      });
    });

    it('timetableStatistics should count its own year and nothing of another institute year', async () => {
      expect(await query(STATISTICS, { academicYearId: a.yearId })).toEqual({
        timetableStatistics: { total: 3, draft: 2, active: 1, inactive: 0, archived: 0 },
      });
      expect(await query(STATISTICS, { academicYearId: b.yearId })).toEqual({
        timetableStatistics: { total: 0, draft: 0, active: 0, inactive: 0, archived: 0 },
      });
    });

    it('sectionTimetable should show its own section and nothing of another institute', async () => {
      expect(await query(SECTION_GRID, { sectionId: a.sectionId })).toEqual({
        sectionTimetable: { timetableId: a.timetableId, entries: [{ id: a.entryId }] },
      });
      expect(await query(SECTION_GRID, { sectionId: b.sectionId })).toEqual({
        sectionTimetable: null,
      });
      expect(
        await query(SECTION_GRID, { sectionId: a.sectionId, timetableId: b.timetableId }),
      ).toEqual({ sectionTimetable: null });
      expect(
        await query(SECTION_GRID, { sectionId: b.sectionId, timetableId: a.timetableId }),
      ).toEqual({ sectionTimetable: { timetableId: a.timetableId, entries: [] } });
    });

    it('staffTimetable should show its own teacher and nothing of a teacher of another institute', async () => {
      expect(await query(STAFF_GRID, { teacherId: a.teacherId })).toEqual({
        staffTimetable: {
          timetableId: a.timetableId,
          teacherName: 'Meera Rao',
          entries: [{ id: a.entryId }],
        },
      });
      expect(await query(STAFF_GRID, { teacherId: b.teacherId })).toEqual({
        staffTimetable: { timetableId: a.timetableId, teacherName: null, entries: [] },
      });
      expect(
        await query(STAFF_GRID, { teacherId: a.teacherId, timetableId: b.timetableId }),
      ).toEqual({ staffTimetable: null });
    });

    it.each([
      ['sectionId', () => ({ sectionId: b.sectionId })],
      ['timetableId', () => ({ sectionId: a.sectionId, timetableId: b.timetableId })],
    ] as const)('sectionTimetablePdf should refuse %s of another institute and store nothing', async (_field, variables) => {
      await refusesAndWritesNothing(SECTION_PDF, variables(), ErrorCode.TIMETABLE_NOT_FOUND);
    });

    it('sectionTimetablePdf should render its own section', async () => {
      const data = await query<{ sectionTimetablePdf: string }>(SECTION_PDF, {
        sectionId: a.sectionId,
      });

      expect(
        Buffer.from(data?.sectionTimetablePdf ?? '', 'base64')
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    });

    it('staffTimetablePdf should refuse a timetable of another institute and store nothing', async () => {
      await refusesAndWritesNothing(
        STAFF_PDF,
        { teacherId: a.teacherId, timetableId: b.timetableId },
        ErrorCode.TIMETABLE_NOT_FOUND,
      );
    });

    it('staffTimetablePdf should render nothing of a teacher of another institute', async () => {
      const grid = vi.spyOn(TimetableViewService.prototype, 'staffTimetable');
      const labels = vi.spyOn(TimetableDrizzleRepository.prototype, 'resolveLabels');
      const before = await snapshot();

      const data = await query<{ staffTimetablePdf: string }>(STAFF_PDF, {
        teacherId: b.teacherId,
      });

      expect(
        Buffer.from(data?.staffTimetablePdf ?? '', 'base64')
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      const grids = await Promise.all(grid.mock.results.map((call) => call.value));
      expect(grids.map((g) => ({ timetableId: g?.timetableId, entries: g?.entries }))).toEqual([
        { timetableId: a.timetableId, entries: [] },
      ]);
      const maps = await Promise.all(labels.mock.results.map((call) => call.value));
      expect(maps).toEqual(maps.map(() => ({ subjects: {}, sections: {}, teachers: {} })));
      expect(await snapshot()).toEqual(before);
    });

    it('timetableDaySchedule should show its own section and nothing of another institute section', async () => {
      expect(await query(DAY_SCHEDULE, { sectionId: a.sectionId })).toEqual({
        timetableDaySchedule: {
          timetableId: a.timetableId,
          slots: [
            {
              periodId: a.periodId,
              subjectId: a.subjectId,
              teacherId: a.otherTeacherId,
              isOverride: true,
            },
          ],
        },
      });
      expect(await query(DAY_SCHEDULE, { sectionId: b.sectionId })).toEqual({
        timetableDaySchedule: { timetableId: null, slots: [] },
      });
    });

    it('staffDaySchedule should show its own teacher and nothing of a teacher of another institute', async () => {
      expect(await query(STAFF_DAY, { teacherId: a.teacherId })).toEqual({
        staffDaySchedule: [{ periodId: a.periodId, sectionId: a.sectionId }],
      });
      expect(await query(STAFF_DAY, { teacherId: b.teacherId })).toEqual({
        staffDaySchedule: [],
      });
    });

    it('timetableDayOverrides should list its own timetable and nothing of another institute', async () => {
      expect(await query(OVERRIDES, { timetableId: a.timetableId })).toEqual({
        timetableDayOverrides: [{ id: a.overrideId }],
      });
      expect(await query(OVERRIDES, { timetableId: b.timetableId })).toEqual({
        timetableDayOverrides: [],
      });
    });
  });

  describe('createTimetable', () => {
    it('should create a timetable for its own year and section', async () => {
      const data = await query<{ createTimetable: { id: string } }>(CREATE, {
        academicYearId: a.yearId,
        sectionIds: [a.otherSectionId],
        name: { en: 'Winter' },
      });

      const id = data?.createTimetable.id ?? '';
      const stored = await asAdmin(async (tx) => ({
        timetable: await tx
          .select({ tenantId: timetables.tenantId, academicYearId: timetables.academicYearId })
          .from(timetables)
          .where(eq(timetables.id, id)),
        sections: await tx
          .select({ sectionId: timetableSections.sectionId })
          .from(timetableSections)
          .where(eq(timetableSections.timetableId, id)),
      }));
      expect(stored).toEqual({
        timetable: [{ tenantId: instA.tenantId, academicYearId: a.yearId }],
        sections: [{ sectionId: a.otherSectionId }],
      });
    });

    it.each([
      [
        'academicYearId',
        () => ({ academicYearId: b.yearId, sectionIds: [a.sectionId] }),
        ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
      ],
      [
        'sectionIds',
        () => ({ academicYearId: a.yearId, sectionIds: [b.sectionId] }),
        ErrorCode.SECTION_NOT_FOUND,
      ],
      [
        'sectionIds after its own',
        () => ({ academicYearId: a.yearId, sectionIds: [a.sectionId, b.sectionId] }),
        ErrorCode.SECTION_NOT_FOUND,
      ],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, variables, code) => {
      // A name of its own each time: a create that wrongly succeeds keeps the name taken.
      await refusesAndWritesNothing(
        CREATE,
        { ...variables(), name: { en: `Winter ${randomUUID().slice(0, 8)}` } },
        code,
      );
    });
  });

  it.each([
    ['updateTimetable', UPDATE, () => b.timetableId],
    ['activateTimetable', status('activateTimetable'), () => b.draftTimetableId],
    ['deactivateTimetable', status('deactivateTimetable'), () => b.timetableId],
    ['archiveTimetable', status('archiveTimetable'), () => b.timetableId],
    ['addTimetablePeriod', ADD_PERIOD, () => b.timetableId],
  ] as const)('%s should refuse a timetable of another institute and change neither institute', async (operation, source, id) => {
    const variables = operation === 'addTimetablePeriod' ? { timetableId: id() } : { id: id() };
    await refusesAndWritesNothing(source, variables, ErrorCode.TIMETABLE_NOT_FOUND);
  });

  // The generic NOT_FOUND of `softDelete`, as for a timetable that does not exist.
  it.each([
    ['alone', () => [b.spareTimetableId]],
    ['after its own', () => [a.spareTimetableId, b.spareTimetableId]],
  ] as const)('deleteTimetable should refuse a timetable of another institute %s and delete nothing', async (_case, ids) => {
    await refusesAndWritesNothing(DELETE, { ids: ids() }, ErrorCode.TIMETABLE_NOT_FOUND);
  });

  it.each([
    ['alone', () => [b.deletedTimetableId]],
    ['after its own', () => [a.deletedTimetableId, b.deletedTimetableId]],
  ] as const)('restoreTimetable should refuse a timetable of another institute %s and restore nothing', async (_case, ids) => {
    await refusesAndWritesNothing(RESTORE, { ids: ids() }, ErrorCode.TIMETABLE_NOT_FOUND);
  });

  describe('covered sections', () => {
    it('addTimetableSection should add its own section to its own timetable', async () => {
      await query(ADD_SECTION, { timetableId: a.draftTimetableId, sectionId: a.otherSectionId });

      const stored = await asAdmin((tx) =>
        tx
          .select({ sectionId: timetableSections.sectionId })
          .from(timetableSections)
          .where(eq(timetableSections.timetableId, a.draftTimetableId))
          .orderBy(asc(timetableSections.id)),
      );
      expect(stored).toEqual([{ sectionId: a.sectionId }, { sectionId: a.otherSectionId }]);
    });

    it('removeTimetableSection should remove its own section from its own timetable', async () => {
      await query(REMOVE_SECTION, { timetableId: a.draftTimetableId, sectionId: a.otherSectionId });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            sectionId: timetableSections.sectionId,
            deletedAt: timetableSections.deletedAt,
          })
          .from(timetableSections)
          .where(eq(timetableSections.timetableId, a.draftTimetableId))
          .orderBy(asc(timetableSections.id)),
      );
      expect(stored.map((row) => [row.sectionId, row.deletedAt === null])).toEqual([
        [a.sectionId, true],
        [a.otherSectionId, false],
      ]);
    });

    describe.each([
      ['addTimetableSection', ADD_SECTION],
      ['removeTimetableSection', REMOVE_SECTION],
    ] as const)('%s', (_operation, source) => {
      it('should refuse a timetable of another institute and write nothing', async () => {
        await refusesAndWritesNothing(
          source,
          { timetableId: b.timetableId, sectionId: a.otherSectionId },
          ErrorCode.TIMETABLE_NOT_FOUND,
        );
      });

      it('should refuse a section of another institute and write nothing', async () => {
        await refusesAndWritesNothing(
          source,
          { timetableId: a.timetableId, sectionId: b.sectionId },
          ErrorCode.SECTION_NOT_FOUND,
        );
      });
    });
  });

  describe('periods', () => {
    it('updateTimetablePeriod should rename its own period', async () => {
      await query(UPDATE_PERIOD, { timetableId: a.draftTimetableId, periodId: a.draftPeriodId });

      const stored = await asAdmin((tx) =>
        tx
          .select({ label: timetablePeriods.label })
          .from(timetablePeriods)
          .where(eq(timetablePeriods.id, a.draftPeriodId)),
      );
      expect(stored).toEqual([{ label: 'Zero' }]);
    });

    it.each([
      ['updateTimetablePeriod', UPDATE_PERIOD, ErrorCode.TIMETABLE_PERIOD_NOT_FOUND],
      // The generic NOT_FOUND of `softDelete`, as for a period that does not exist.
      ['removeTimetablePeriod', REMOVE_PERIOD, ErrorCode.NOT_FOUND],
    ] as const)('%s should refuse a period of another institute and write nothing', async (_operation, source, code) => {
      await refusesAndWritesNothing(
        source,
        { timetableId: a.timetableId, periodId: b.periodId },
        code,
      );
    });

    it.each([
      ['updateTimetablePeriod', UPDATE_PERIOD],
      ['removeTimetablePeriod', REMOVE_PERIOD],
    ] as const)('%s should refuse a timetable of another institute and write nothing', async (_operation, source) => {
      await refusesAndWritesNothing(
        source,
        { timetableId: b.timetableId, periodId: a.periodId },
        ErrorCode.TIMETABLE_NOT_FOUND,
      );
    });
  });

  describe('entries', () => {
    const assignInput = (
      foreign: Record<string, unknown> = {},
      splits: Record<string, unknown>[] = [
        { splitIndex: 0, subjectId: a.subjectId, teacherId: a.otherTeacherId },
      ],
    ) => ({
      timetableId: a.draftTimetableId,
      sectionId: a.sectionId,
      periodId: a.draftPeriodId,
      days: ['TUESDAY'],
      splits,
      ...foreign,
    });
    const clearInput = (foreign: Record<string, unknown> = {}) => ({
      timetableId: a.timetableId,
      sectionId: a.sectionId,
      periodId: a.periodId,
      dayOfWeek: 'MONDAY',
      ...foreign,
    });
    const cellOf = () =>
      asAdmin((tx) =>
        tx
          .select({
            subjectId: timetableEntries.subjectId,
            teacherId: timetableEntries.teacherId,
            deleted: timetableEntries.deletedAt,
          })
          .from(timetableEntries)
          .where(
            and(
              eq(timetableEntries.timetableId, a.draftTimetableId),
              eq(timetableEntries.dayOfWeek, 'TUESDAY'),
              eq(timetableEntries.splitIndex, 0),
            ),
          ),
      );

    it('assignTimetableEntry should store its own subject and teacher in its own cell', async () => {
      await query(ASSIGN, { input: assignInput() });

      expect(await cellOf()).toEqual([
        { subjectId: a.subjectId, teacherId: a.otherTeacherId, deleted: null },
      ]);
    });

    it.each([
      [
        'timetableId',
        () => assignInput({ timetableId: b.draftTimetableId }),
        ErrorCode.TIMETABLE_NOT_FOUND,
      ],
      // Checked against the sections the timetable covers: a foreign one is never covered.
      [
        'sectionId',
        () => assignInput({ sectionId: b.sectionId }),
        ErrorCode.TIMETABLE_SECTION_NOT_COVERED,
      ],
      [
        'periodId',
        () => assignInput({ periodId: b.draftPeriodId }),
        ErrorCode.TIMETABLE_PERIOD_NOT_FOUND,
      ],
      [
        'splits[].subjectId',
        () => assignInput({}, [{ splitIndex: 0, subjectId: b.subjectId }]),
        ErrorCode.SUBJECT_NOT_FOUND,
      ],
      [
        'splits[].teacherId',
        () => assignInput({}, [{ splitIndex: 0, teacherId: b.teacherId }]),
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
      [
        'splits[].teacherId after its own split',
        () =>
          assignInput({}, [
            { splitIndex: 0, splitLabel: 'G1', teacherId: a.teacherId },
            { splitIndex: 1, splitLabel: 'G2', teacherId: b.teacherId },
          ]),
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
    ] as const)('assignTimetableEntry should refuse %s of another institute and write nothing', async (_field, input, code) => {
      await refusesAndWritesNothing(ASSIGN, { input: input() }, code);
    });

    it('clearTimetableEntry should clear its own cell', async () => {
      await query(CLEAR, {
        input: {
          timetableId: a.draftTimetableId,
          sectionId: a.sectionId,
          periodId: a.draftPeriodId,
          dayOfWeek: 'TUESDAY',
        },
      });

      const [cell] = await cellOf();
      expect(cell?.deleted).toBeInstanceOf(Date);
    });

    it.each([
      [
        'timetableId',
        () => clearInput({ timetableId: b.timetableId }),
        ErrorCode.TIMETABLE_NOT_FOUND,
      ],
      [
        'sectionId',
        () => clearInput({ sectionId: b.sectionId }),
        ErrorCode.TIMETABLE_SECTION_NOT_COVERED,
      ],
      [
        'periodId',
        () => clearInput({ periodId: b.periodId }),
        ErrorCode.TIMETABLE_PERIOD_NOT_FOUND,
      ],
    ] as const)('clearTimetableEntry should refuse %s of another institute and write nothing', async (_field, input, code) => {
      await refusesAndWritesNothing(CLEAR, { input: input() }, code);
    });
  });

  describe('day overrides', () => {
    const overrideInput = (foreign: Record<string, unknown> = {}) => ({
      timetableId: a.draftTimetableId,
      date: MONDAY,
      sectionId: a.sectionId,
      periodId: a.draftPeriodId,
      overrideType: 'SUBSTITUTION',
      subjectId: a.subjectId,
      teacherId: a.otherTeacherId,
      ...foreign,
    });

    it('createTimetableDayOverride should store an override of its own cell', async () => {
      const data = await query<{ createTimetableDayOverride: { id: string } }>(CREATE_OVERRIDE, {
        input: overrideInput(),
      });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            tenantId: timetableDayOverrides.tenantId,
            sectionId: timetableDayOverrides.sectionId,
            periodId: timetableDayOverrides.periodId,
            subjectId: timetableDayOverrides.subjectId,
            teacherId: timetableDayOverrides.teacherId,
          })
          .from(timetableDayOverrides)
          .where(eq(timetableDayOverrides.id, data?.createTimetableDayOverride.id ?? '')),
      );
      expect(stored).toEqual([
        {
          tenantId: instA.tenantId,
          sectionId: a.sectionId,
          periodId: a.draftPeriodId,
          subjectId: a.subjectId,
          teacherId: a.otherTeacherId,
        },
      ]);
    });

    // A Monday of its own each time: the own case above holds MONDAY's cell, and an override
    // that wrongly succeeds would hold the next case's.
    it.each([
      [
        'timetableId',
        '2026-12-14',
        () => ({ timetableId: b.draftTimetableId }),
        ErrorCode.TIMETABLE_NOT_FOUND,
      ],
      [
        'sectionId',
        '2026-12-21',
        () => ({ sectionId: b.sectionId }),
        ErrorCode.TIMETABLE_SECTION_NOT_COVERED,
      ],
      [
        'periodId',
        '2026-12-28',
        () => ({ periodId: b.draftPeriodId }),
        ErrorCode.TIMETABLE_PERIOD_NOT_FOUND,
      ],
      ['subjectId', '2027-01-04', () => ({ subjectId: b.subjectId }), ErrorCode.SUBJECT_NOT_FOUND],
      [
        'teacherId',
        '2027-01-11',
        () => ({ teacherId: b.teacherId }),
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
    ] as const)('createTimetableDayOverride should refuse %s of another institute and write nothing', async (_field, date, foreign, code) => {
      await refusesAndWritesNothing(
        CREATE_OVERRIDE,
        { input: overrideInput({ date, ...foreign() }) },
        code,
      );
    });

    it('clearTimetableDayOverride should refuse an override of another institute and change neither institute', async () => {
      await refusesAndWritesNothing(
        CLEAR_OVERRIDE,
        { id: b.overrideId },
        ErrorCode.TIMETABLE_OVERRIDE_NOT_FOUND,
      );
    });
  });

  it('removeTimetablePeriod should remove its own period and clear its cells', async () => {
    await query(REMOVE_PERIOD, { timetableId: a.draftTimetableId, periodId: a.draftPeriodId });

    const [period] = await asAdmin((tx) =>
      tx
        .select({ deletedAt: timetablePeriods.deletedAt })
        .from(timetablePeriods)
        .where(eq(timetablePeriods.id, a.draftPeriodId)),
    );
    expect(period?.deletedAt).toBeInstanceOf(Date);
  });
});
