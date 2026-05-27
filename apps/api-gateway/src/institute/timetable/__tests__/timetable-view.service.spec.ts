import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimetableRepository } from '../repositories/timetable.repository';
import type {
  TimetableDayOverrideRecord,
  TimetableEntryRecord,
  TimetablePeriodRecord,
  TimetableRecord,
} from '../repositories/types';
import { TimetableViewService } from '../timetable-view.service';

const TT = '11111111-1111-1111-1111-111111111111';
const SECTION = '22222222-2222-2222-2222-222222222222';
const P1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const LUNCH = 'aaaaaaaa-0000-0000-0000-000000000002';
const TEACHER = '55555555-5555-5555-5555-555555555555';
const SUB = '66666666-6666-6666-6666-666666666666';

// 2026-05-25 is a Monday.
const MONDAY = '2026-05-25';

function timetable(over: Partial<TimetableRecord> = {}): TimetableRecord {
  return {
    id: TT,
    tenantId: 'tenant',
    academicYearId: 'ay',
    name: { en: 'TT' },
    description: null,
    status: 'ACTIVE',
    effectiveFrom: '2026-04-01',
    effectiveTo: '2027-03-31',
    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    dayStartTime: '08:00:00',
    defaultPeriodDurationMins: 45,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const periods: TimetablePeriodRecord[] = [
  {
    id: P1,
    tenantId: 'tenant',
    timetableId: TT,
    kind: 'PERIOD',
    label: '1',
    sequence: 1,
    startTime: '08:00:00',
    endTime: '08:45:00',
    session: 'MAIN',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: LUNCH,
    tenantId: 'tenant',
    timetableId: TT,
    kind: 'BREAK',
    label: 'Lunch',
    sequence: 2,
    startTime: '08:45:00',
    endTime: '09:15:00',
    session: 'MAIN',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function entry(over: Partial<TimetableEntryRecord> = {}): TimetableEntryRecord {
  return {
    id: 'e1',
    tenantId: 'tenant',
    timetableId: TT,
    periodId: P1,
    sectionId: SECTION,
    dayOfWeek: 'MONDAY',
    splitIndex: 0,
    splitLabel: null,
    subjectId: SUB,
    teacherId: TEACHER,
    room: '101',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function override(over: Partial<TimetableDayOverrideRecord> = {}): TimetableDayOverrideRecord {
  return {
    id: 'o1',
    tenantId: 'tenant',
    timetableId: TT,
    date: MONDAY,
    sectionId: SECTION,
    periodId: P1,
    splitIndex: 0,
    overrideType: 'SUBSTITUTION',
    subjectId: null,
    teacherId: null,
    room: null,
    originalSubjectId: null,
    originalTeacherId: null,
    reason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('TimetableViewService.daySchedule', () => {
  let repo: TimetableRepository;
  let service: TimetableViewService;

  beforeEach(() => {
    repo = createMock<TimetableRepository>({
      findTimetableById: vi.fn().mockResolvedValue(timetable()),
      listTimetables: vi
        .fn()
        .mockResolvedValue({ docs: [timetable()], total: 1, page: 1, perPage: 1, totalPages: 1 }),
      findPeriods: vi.fn().mockResolvedValue(periods),
      findEntriesBySection: vi.fn().mockResolvedValue([entry()]),
      findOverridesByDate: vi.fn().mockResolvedValue([]),
    });
    service = new TimetableViewService(repo, createMock<EventBusService>({ emit: vi.fn() }));
  });

  it('returns the master cell when there is no override', async () => {
    const schedule = await service.daySchedule(MONDAY, SECTION, TT);
    expect(schedule.dayOfWeek).toBe('MONDAY');
    const slot = schedule.slots.find((s) => s.periodId === P1);
    expect(slot).toMatchObject({ teacherId: TEACHER, subjectId: SUB, isOverride: false });
    // The break renders as a non-assignable slot.
    expect(schedule.slots.find((s) => s.periodId === LUNCH)?.kind).toBe('BREAK');
  });

  it('applies a substitution override (teacher replaced, isOverride=true)', async () => {
    const substitute = '77777777-7777-7777-7777-777777777777';
    vi.mocked(repo.findOverridesByDate).mockResolvedValue([
      override({ overrideType: 'SUBSTITUTION', teacherId: substitute }),
    ]);
    const schedule = await service.daySchedule(MONDAY, SECTION, TT);
    const slot = schedule.slots.find((s) => s.periodId === P1);
    expect(slot).toMatchObject({
      teacherId: substitute,
      subjectId: SUB, // falls back to master subject
      isOverride: true,
      overrideType: 'SUBSTITUTION',
    });
  });

  it('omits a cancelled period for that date', async () => {
    vi.mocked(repo.findOverridesByDate).mockResolvedValue([
      override({ overrideType: 'CANCELLATION' }),
    ]);
    const schedule = await service.daySchedule(MONDAY, SECTION, TT);
    expect(schedule.slots.find((s) => s.periodId === P1 && s.kind === 'PERIOD')).toBeUndefined();
  });

  it('returns no slots when the date falls outside the timetable range', async () => {
    const schedule = await service.daySchedule('2030-01-07', SECTION, TT);
    expect(schedule.slots).toEqual([]);
  });

  it('returns no slots when the weekday is not a working day', async () => {
    vi.mocked(repo.findTimetableById).mockResolvedValue(
      timetable({ workingDays: ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }),
    );
    const schedule = await service.daySchedule(MONDAY, SECTION, TT);
    expect(schedule.slots).toEqual([]);
  });

  it('renders a vacant period (no entry, no override) as an empty slot', async () => {
    vi.mocked(repo.findEntriesBySection).mockResolvedValue([]);
    const schedule = await service.daySchedule(MONDAY, SECTION, TT);
    const slot = schedule.slots.find((s) => s.periodId === P1);
    expect(slot).toMatchObject({ teacherId: null, subjectId: null, isOverride: false });
  });
});
