import assert from 'node:assert';
import { TimetableOverrideType, Weekday } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsInstituteAdminSecondInstitute } from './helpers/auth';
import { gql } from './helpers/gql-client';

const ALL_DAYS = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
];
// 2026-04-06 is a Monday inside the effective range below.
const A_MONDAY = '2026-04-06';

interface CreatedTimetable {
  id: string;
  status: string;
}
interface Period {
  id: string;
  kind: string;
  label: string;
}

describe('Timetable E2E (institute scope)', () => {
  let token: string;
  let standardId: string;
  let sectionId: string;
  const academicYearId = SEED_IDS.ACADEMIC_YEAR_INST1;
  const teacherId = SEED_IDS.MEMBERSHIP_TEACHER_INST1;

  beforeAll(async () => {
    ({ accessToken: token } = await loginAsInstituteAdmin());

    const stdRes = await gql<{ standards: { id: string }[] }>(
      `query S($y: ID!) { standards(academicYearId: $y) { id } }`,
      { y: academicYearId },
      token,
    );
    assert(!stdRes.errors, JSON.stringify(stdRes.errors));
    const standard = stdRes.data?.standards[0];
    assert(standard, 'seed must provide at least one standard for INSTITUTE_1');
    standardId = standard.id;

    const secRes = await gql<{ sections: { id: string }[] }>(
      `query Sec($s: ID!) { sections(standardId: $s) { id } }`,
      { s: standardId },
      token,
    );
    assert(!secRes.errors, JSON.stringify(secRes.errors));
    const section = secRes.data?.sections[0];
    assert(section, 'seed must provide at least one section under the standard');
    sectionId = section.id;
  });

  async function createTimetable(suffix: string, accessToken = token) {
    const res = await gql<{ createTimetable: CreatedTimetable }>(
      `mutation C($input: CreateTimetableInput!) { createTimetable(input: $input) { id status } }`,
      {
        input: {
          academicYearId,
          name: { en: `E2E Timetable ${suffix} ${Date.now()}` },
          effectiveFrom: '2026-04-01',
          effectiveTo: '2027-03-31',
          workingDays: ALL_DAYS,
          dayStartTime: '08:00',
          defaultPeriodDurationMins: 45,
          periodsCount: 6,
          sectionIds: [sectionId],
          lunch: [{ name: 'Lunch', afterPeriod: 3, durationMins: 30 }],
          extraClass: [{ session: 'MORNING', startTime: '07:15', durationMins: 30, count: 1 }],
        },
      },
      accessToken,
    );
    return res;
  }

  async function deleteTimetable(id: string) {
    await gql(`mutation Del($ids: [ID!]!) { deleteTimetable(ids: $ids) }`, { ids: [id] }, token);
  }

  async function firstPeriod(id: string): Promise<Period> {
    const res = await gql<{ timetable: { periods: Period[] } }>(
      `query T($id: ID!) { timetable(id: $id) { periods { id kind label } } }`,
      { id },
      token,
    );
    assert(!res.errors, JSON.stringify(res.errors));
    const p1 = res.data?.timetable.periods.find((p) => p.kind === 'PERIOD' && p.label === '1');
    assert(p1, 'generated grid must contain regular period "1"');
    return p1;
  }

  it('runs the full lifecycle: create → activate → assign → views → override → delete', async () => {
    const createRes = await createTimetable('lifecycle');
    expect(createRes.errors).toBeUndefined();
    const tt = createRes.data?.createTimetable;
    assert(tt);
    expect(tt.status).toBe('DRAFT');

    // Grid was generated (regular periods + the lunch break + the morning extra).
    const detail = await gql<{ timetable: { periods: Period[] } }>(
      `query T($id: ID!) { timetable(id: $id) { periods { id kind label } } }`,
      { id: tt.id },
      token,
    );
    expect(detail.errors).toBeUndefined();
    const periods = detail.data?.timetable.periods ?? [];
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.find((p) => p.kind === 'BREAK')?.label).toBe('Lunch');
    expect(periods.some((p) => p.kind === 'EXTRA')).toBe(true);
    const period1 = periods.find((p) => p.kind === 'PERIOD' && p.label === '1');
    assert(period1);

    // Activate (transactional single-active swap).
    const act = await gql<{ activateTimetable: { status: string } }>(
      `mutation A($id: ID!) { activateTimetable(id: $id) { status } }`,
      { id: tt.id },
      token,
    );
    expect(act.errors).toBeUndefined();
    expect(act.data?.activateTimetable.status).toBe('ACTIVE');

    // Assign the seeded teacher to period 1 on Monday.
    const assign = await gql<{ assignTimetableEntry: { id: string; teacherId: string }[] }>(
      `mutation Asg($input: AssignTimetableEntryInput!) {
        assignTimetableEntry(input: $input) { id teacherId dayOfWeek }
      }`,
      {
        input: {
          timetableId: tt.id,
          sectionId,
          periodId: period1.id,
          days: [Weekday.MONDAY],
          splits: [{ splitIndex: 0, teacherId, room: 'R-101' }],
        },
      },
      token,
    );
    expect(assign.errors).toBeUndefined();
    expect(assign.data?.assignTimetableEntry[0]?.teacherId).toBe(teacherId);

    // Section grid reflects the assignment.
    const grid = await gql<{
      sectionTimetable: { entries: { teacherId: string | null }[] } | null;
    }>(
      `query G($s: ID!) { sectionTimetable(sectionId: $s) { timetableId entries { teacherId } } }`,
      { s: sectionId },
      token,
    );
    expect(grid.errors).toBeUndefined();
    expect(grid.data?.sectionTimetable?.entries.some((e) => e.teacherId === teacherId)).toBe(true);

    // Day schedule (any date) resolves the master entry.
    const day = await gql<{ timetableDaySchedule: { slots: { teacherId: string | null }[] } }>(
      `query D($date: String!, $s: ID!) {
        timetableDaySchedule(date: $date, sectionId: $s) { date dayOfWeek slots { periodId teacherId } }
      }`,
      { date: A_MONDAY, s: sectionId },
      token,
    );
    expect(day.errors).toBeUndefined();
    expect(day.data?.timetableDaySchedule.slots.some((s) => s.teacherId === teacherId)).toBe(true);

    // Per-date override: cancel that period for the Monday.
    const override = await gql<{ createTimetableDayOverride: { id: string } }>(
      `mutation O($input: CreateTimetableDayOverrideInput!) {
        createTimetableDayOverride(input: $input) { id }
      }`,
      {
        input: {
          timetableId: tt.id,
          date: A_MONDAY,
          sectionId,
          periodId: period1.id,
          overrideType: TimetableOverrideType.CANCELLATION,
        },
      },
      token,
    );
    expect(override.errors).toBeUndefined();

    // Soft-delete.
    const del = await gql<{ deleteTimetable: number }>(
      `mutation Del($ids: [ID!]!) { deleteTimetable(ids: $ids) }`,
      { ids: [tt.id] },
      token,
    );
    expect(del.errors).toBeUndefined();
    expect(del.data?.deleteTimetable).toBe(1);
  });

  it('rejects a teacher double-booked in the same slot', async () => {
    const createRes = await createTimetable('conflict');
    const tt = createRes.data?.createTimetable;
    assert(tt);
    const period1 = await firstPeriod(tt.id);

    // Two parallel splits assigned to the same teacher in one slot → conflict.
    const res = await gql(
      `mutation Asg($input: AssignTimetableEntryInput!) { assignTimetableEntry(input: $input) { id } }`,
      {
        input: {
          timetableId: tt.id,
          sectionId,
          periodId: period1.id,
          days: [Weekday.MONDAY],
          splits: [
            { splitIndex: 0, teacherId },
            { splitIndex: 1, teacherId },
          ],
        },
      },
      token,
    );
    expect(res.errors).toBeDefined();
    expect(JSON.stringify(res.errors)).toContain('TIMETABLE_TEACHER_CONFLICT');

    await deleteTimetable(tt.id);
  });

  it('does not leak timetables across tenants', async () => {
    const createRes = await createTimetable('isolation');
    const tt = createRes.data?.createTimetable;
    assert(tt);

    const { accessToken: otherToken } = await loginAsInstituteAdminSecondInstitute();
    const res = await gql<{ timetable: { id: string } | null }>(
      `query T($id: ID!) { timetable(id: $id) { id } }`,
      { id: tt.id },
      otherToken,
    );
    // RLS must hide the row — either a not-found error or null, never the id.
    const leaked = !res.errors && res.data?.timetable?.id === tt.id;
    expect(leaked).toBe(false);

    await deleteTimetable(tt.id);
  });

  it('rejects unauthenticated access', async () => {
    const res = await gql(`query { timetableStatistics(academicYearId: null) { total } }`);
    expect(res.errors).toBeDefined();
  });
});
