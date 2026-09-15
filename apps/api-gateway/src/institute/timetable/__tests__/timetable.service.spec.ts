import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicYearRepository } from '../../academic-year/repositories/academic-year.repository';
import type { AcademicYearRecord } from '../../academic-year/repositories/types';
import type { TimetableRepository } from '../repositories/timetable.repository';
import type { PaginatedTimetables, TimetableRecord } from '../repositories/types';
import { type CreateTimetableServiceInput, TimetableService } from '../timetable.service';
import { TimetableGenerationService } from '../timetable-generation.service';

function yearRec(over: Partial<AcademicYearRecord> = {}): AcademicYearRecord {
  return {
    id: 'ay-active',
    tenantId: 'tenant',
    label: '2025-26',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
    isActive: true,
    status: 'ACTIVE',
    termStructure: [],
    boardExamDates: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function timetableRec(over: Partial<TimetableRecord> = {}): TimetableRecord {
  return {
    id: 'tt-1',
    tenantId: 'tenant',
    academicYearId: 'ay-active',
    name: { en: 'Main' },
    description: null,
    status: 'DRAFT',
    effectiveFrom: '2025-06-01',
    effectiveTo: '2026-04-30',
    workingDays: ['MONDAY'],
    dayStartTime: '08:00',
    defaultPeriodDurationMins: 45,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function createInput(over: Partial<CreateTimetableServiceInput> = {}): CreateTimetableServiceInput {
  return {
    name: { en: 'Main' },
    effectiveFrom: '2025-06-01',
    effectiveTo: '2026-04-30',
    workingDays: ['MONDAY'],
    dayStartTime: '08:00',
    defaultPeriodDurationMins: 45,
    periodsCount: 8,
    sectionIds: ['sec-1'],
    lunch: [],
    extraClass: [],
    ...over,
  };
}

// An omitted year means the current session (the single ACTIVE year);
// an explicit year passes through for planning flows on other years.
describe('TimetableService year resolution', () => {
  let repo: TimetableRepository;
  let academicYearRepo: AcademicYearRepository;
  let service: TimetableService;

  beforeEach(() => {
    repo = createMock<TimetableRepository>();
    academicYearRepo = createMock<AcademicYearRepository>();
    service = new TimetableService(
      repo,
      createMock<TimetableGenerationService>({ generatePeriods: vi.fn().mockReturnValue([]) }),
      createMock<EventBusService>(),
      academicYearRepo,
    );
  });

  it('should list with an explicit year untouched', async () => {
    const page = { docs: [], total: 0, page: 1, perPage: 20, totalPages: 1 } as PaginatedTimetables;
    vi.mocked(repo.listTimetables).mockResolvedValue(page);

    await expect(
      service.list({ academicYearId: 'ay-planning', page: 1, perPage: 20 }),
    ).resolves.toBe(page);
    expect(repo.listTimetables).toHaveBeenCalledWith(
      expect.objectContaining({ academicYearId: 'ay-planning' }),
    );
    expect(academicYearRepo.findActive).not.toHaveBeenCalled();
  });

  it('should list in the active year when omitted', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    vi.mocked(repo.listTimetables).mockResolvedValue({
      docs: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 1,
    });

    await service.list({ page: 1, perPage: 20 });

    expect(repo.listTimetables).toHaveBeenCalledWith(
      expect.objectContaining({ academicYearId: 'ay-active' }),
    );
  });

  it('should throw NO_ACTIVE_ACADEMIC_YEAR when listing with no active year', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(null);

    const failure = await service.list({ page: 1, perPage: 20 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BusinessException);
    expect((failure as BusinessException).code).toBe(ErrorCode.NO_ACTIVE_ACADEMIC_YEAR);
    expect(repo.listTimetables).not.toHaveBeenCalled();
  });

  it('should create in the active year when omitted', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    vi.mocked(repo.createWithGrid).mockResolvedValue(timetableRec());

    await service.create(createInput());

    expect(repo.createWithGrid).toHaveBeenCalledWith(
      expect.objectContaining({ academicYearId: 'ay-active' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should create with an explicit year untouched', async () => {
    vi.mocked(repo.createWithGrid).mockResolvedValue(timetableRec());

    await service.create(createInput({ academicYearId: 'ay-planning' }));

    expect(repo.createWithGrid).toHaveBeenCalledWith(
      expect.objectContaining({ academicYearId: 'ay-planning' }),
      expect.anything(),
      expect.anything(),
    );
    expect(academicYearRepo.findActive).not.toHaveBeenCalled();
  });

  it('should scope statistics to the active year when omitted', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    vi.mocked(repo.statistics).mockResolvedValue({
      total: 0,
      draft: 0,
      active: 0,
      inactive: 0,
      archived: 0,
    });

    await service.statistics(undefined);

    expect(repo.statistics).toHaveBeenCalledWith('ay-active');
  });
});
