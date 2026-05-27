import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TimetableRepository } from '../repositories/timetable.repository';
import type {
  TimetableEntryRecord,
  TimetableLabelMaps,
  TimetablePeriodRecord,
  TimetableRecord,
} from '../repositories/types';
import { TimetablePdfService } from '../timetable-pdf.service';
import type { TimetableGrid, TimetableViewService } from '../timetable-view.service';

const TT = '11111111-1111-1111-1111-111111111111';
const SECTION = '22222222-2222-2222-2222-222222222222';
const TEACHER = '55555555-5555-5555-5555-555555555555';
const SUB = '66666666-6666-6666-6666-666666666666';
const P1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const BREAK = 'aaaaaaaa-0000-0000-0000-000000000002';

const periods: TimetablePeriodRecord[] = [
  {
    id: P1,
    tenantId: 't',
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
    id: BREAK,
    tenantId: 't',
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
    tenantId: 't',
    timetableId: TT,
    periodId: P1,
    sectionId: SECTION,
    dayOfWeek: 'MONDAY',
    splitIndex: 0,
    splitLabel: null,
    subjectId: SUB,
    teacherId: TEACHER,
    room: 'R-101',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const grid: TimetableGrid = {
  timetableId: TT,
  periods,
  workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
  entries: [entry()],
};

const labels: TimetableLabelMaps = {
  subjects: { [SUB]: 'Mathematics' },
  sections: { [SECTION]: 'Class 5 - A' },
  teachers: { [TEACHER]: 'Rajesh Sharma' },
};

const timetable: TimetableRecord = {
  id: TT,
  tenantId: 't',
  academicYearId: 'ay',
  name: { en: 'Main Timetable' },
  description: null,
  status: 'ACTIVE',
  effectiveFrom: '2026-04-01',
  effectiveTo: '2027-03-31',
  workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
  dayStartTime: '08:00:00',
  defaultPeriodDurationMins: 45,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** First bytes of every PDF file. */
const PDF_MAGIC = '%PDF';

describe('TimetablePdfService', () => {
  let view: TimetableViewService;
  let repo: TimetableRepository;
  let service: TimetablePdfService;

  beforeEach(() => {
    view = createMock<TimetableViewService>({
      sectionTimetable: async () => grid,
      staffTimetable: async () => grid,
    });
    repo = createMock<TimetableRepository>({
      findTimetableById: async () => timetable,
      resolveLabels: async () => labels,
    });
    service = new TimetablePdfService(view, repo);
  });

  it('renders a section timetable as a non-empty PDF buffer', async () => {
    const buffer = await service.sectionTimetablePdf(SECTION);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe(PDF_MAGIC);
  });

  it('renders a staff timetable as a non-empty PDF buffer', async () => {
    const buffer = await service.staffTimetablePdf(TEACHER);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe(PDF_MAGIC);
  });

  it('resolves labels for the subjects, sections, and teachers in the grid', async () => {
    await service.sectionTimetablePdf(SECTION);
    expect(repo.resolveLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectIds: [SUB],
        teacherIds: [TEACHER],
      }),
    );
  });

  it('throws when no timetable covers the section', async () => {
    view = createMock<TimetableViewService>({ sectionTimetable: async () => null });
    service = new TimetablePdfService(view, repo);
    await expect(service.sectionTimetablePdf(SECTION)).rejects.toThrow();
  });
});
