import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimetableRepository } from '../repositories/timetable.repository';
import type {
  TimetableEntryRecord,
  TimetablePeriodRecord,
  TimetableSectionRecord,
} from '../repositories/types';
import { TimetableScheduleService } from '../timetable-schedule.service';

const TT = '11111111-1111-1111-1111-111111111111';
const SECTION_A = '22222222-2222-2222-2222-222222222222';
const SECTION_B = '33333333-3333-3333-3333-333333333333';
const PERIOD = '44444444-4444-4444-4444-444444444444';
const TEACHER = '55555555-5555-5555-5555-555555555555';

function periodRec(over: Partial<TimetablePeriodRecord> = {}): TimetablePeriodRecord {
  return {
    id: PERIOD,
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
    ...over,
  };
}

function entryRec(over: Partial<TimetableEntryRecord> = {}): TimetableEntryRecord {
  return {
    id: 'e1',
    tenantId: 'tenant',
    timetableId: TT,
    periodId: PERIOD,
    sectionId: SECTION_A,
    dayOfWeek: 'MONDAY',
    splitIndex: 0,
    splitLabel: null,
    subjectId: null,
    teacherId: null,
    room: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const sectionRows: TimetableSectionRecord[] = [
  {
    id: 's1',
    tenantId: 'tenant',
    timetableId: TT,
    sectionId: SECTION_A,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 's2',
    tenantId: 'tenant',
    timetableId: TT,
    sectionId: SECTION_B,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('TimetableScheduleService.assignEntry', () => {
  let repo: TimetableRepository;
  let eventBus: EventBusService;
  let service: TimetableScheduleService;

  beforeEach(() => {
    repo = createMock<TimetableRepository>({
      findTimetableById: vi.fn().mockResolvedValue({ id: TT, tenantId: 'tenant' }),
      findPeriodById: vi.fn().mockResolvedValue(periodRec()),
      findSections: vi.fn().mockResolvedValue(sectionRows),
      findEntriesAtSlot: vi.fn().mockResolvedValue([]),
      upsertEntry: vi.fn().mockImplementation((d) => Promise.resolve(entryRec(d))),
    });
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    service = new TimetableScheduleService(repo, eventBus);
  });

  it('assigns a cell and emits entry_assigned', async () => {
    const result = await service.assignEntry({
      timetableId: TT,
      sectionId: SECTION_A,
      periodId: PERIOD,
      days: ['MONDAY'],
      splits: [{ splitIndex: 0, subjectId: null, teacherId: TEACHER, room: '101' }],
    });

    expect(result).toHaveLength(1);
    expect(repo.upsertEntry).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'TIMETABLE.entry_assigned',
      expect.objectContaining({ timetableId: TT, sectionId: SECTION_A, periodId: PERIOD }),
    );
  });

  it('rejects assigning to a BREAK period', async () => {
    vi.mocked(repo.findPeriodById).mockResolvedValue(periodRec({ kind: 'BREAK', label: 'Lunch' }));
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: SECTION_A,
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [{ splitIndex: 0, teacherId: TEACHER }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMETABLE_PERIOD_NOT_ASSIGNABLE });
  });

  it('rejects a section not covered by the timetable', async () => {
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: '99999999-9999-9999-9999-999999999999',
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [{ splitIndex: 0, teacherId: TEACHER }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMETABLE_SECTION_NOT_COVERED });
  });

  it('rejects a teacher already booked in another section at the same slot', async () => {
    // Teacher already teaching SECTION_B in this period on Monday.
    vi.mocked(repo.findEntriesAtSlot).mockResolvedValue([
      entryRec({ id: 'other', sectionId: SECTION_B, teacherId: TEACHER }),
    ]);
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: SECTION_A,
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [{ splitIndex: 0, teacherId: TEACHER }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMETABLE_TEACHER_CONFLICT });
    expect(repo.upsertEntry).not.toHaveBeenCalled();
  });

  it('rejects a room already in use in another section at the same slot', async () => {
    vi.mocked(repo.findEntriesAtSlot).mockResolvedValue([
      entryRec({ id: 'other', sectionId: SECTION_B, room: 'Lab 1' }),
    ]);
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: SECTION_A,
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [{ splitIndex: 0, room: 'Lab 1' }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMETABLE_ROOM_CONFLICT });
  });

  it('rejects the same teacher in two splits within one request (intra-batch)', async () => {
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: SECTION_A,
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [
          { splitIndex: 0, teacherId: TEACHER },
          { splitIndex: 1, teacherId: TEACHER },
        ],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMETABLE_TEACHER_CONFLICT });
  });

  it('allows re-assigning the same cell to the same teacher (no self-conflict)', async () => {
    // The teacher's only existing booking is this exact cell being updated.
    vi.mocked(repo.findEntriesAtSlot).mockResolvedValue([
      entryRec({ sectionId: SECTION_A, splitIndex: 0, teacherId: TEACHER }),
    ]);
    const result = await service.assignEntry({
      timetableId: TT,
      sectionId: SECTION_A,
      periodId: PERIOD,
      days: ['MONDAY'],
      splits: [{ splitIndex: 0, teacherId: TEACHER, subjectId: null }],
    });
    expect(result).toHaveLength(1);
  });

  it('throws NotFound when the timetable does not exist', async () => {
    vi.mocked(repo.findTimetableById).mockResolvedValue(null);
    await expect(
      service.assignEntry({
        timetableId: TT,
        sectionId: SECTION_A,
        periodId: PERIOD,
        days: ['MONDAY'],
        splits: [{ splitIndex: 0 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
