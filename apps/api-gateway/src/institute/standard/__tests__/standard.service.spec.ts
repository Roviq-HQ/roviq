import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicYearRepository } from '../../academic-year/repositories/academic-year.repository';
import type { AcademicYearRecord } from '../../academic-year/repositories/types';
import type { StandardRepository } from '../repositories/standard.repository';
import type { StandardRecord } from '../repositories/types';
import { StandardService } from '../standard.service';

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

function standardRec(over: Partial<StandardRecord> = {}): StandardRecord {
  return {
    id: 'std-1',
    tenantId: 'tenant',
    academicYearId: 'ay-active',
    name: { en: 'Class 5' },
    numericOrder: 5,
    level: null,
    nepStage: null,
    department: null,
    isBoardExamClass: false,
    streamApplicable: false,
    maxSectionsAllowed: null,
    maxStudentsPerSection: null,
    udiseClassCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// An omitted year means the current session (the single ACTIVE year);
// an explicit year passes through for planning flows on other years.
describe('StandardService.findByAcademicYear', () => {
  let repo: StandardRepository;
  let academicYearRepo: AcademicYearRepository;
  let service: StandardService;

  beforeEach(() => {
    repo = createMock<StandardRepository>();
    academicYearRepo = createMock<AcademicYearRepository>();
    service = new StandardService(repo, academicYearRepo, createMock<EventBusService>());
  });

  it('should pass an explicit year straight through to the repository', async () => {
    const rows = [standardRec()];
    vi.mocked(repo.findByAcademicYear).mockResolvedValue(rows);

    await expect(service.findByAcademicYear('ay-planning')).resolves.toBe(rows);
    expect(repo.findByAcademicYear).toHaveBeenCalledWith('ay-planning');
    expect(academicYearRepo.findActive).not.toHaveBeenCalled();
  });

  it('should resolve an omitted year to the active year', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    const rows = [standardRec()];
    vi.mocked(repo.findByAcademicYear).mockResolvedValue(rows);

    await expect(service.findByAcademicYear()).resolves.toBe(rows);
    expect(repo.findByAcademicYear).toHaveBeenCalledWith('ay-active');
  });

  it('should treat an explicit null the same as omitted', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    vi.mocked(repo.findByAcademicYear).mockResolvedValue([]);

    await service.findByAcademicYear(null);

    expect(repo.findByAcademicYear).toHaveBeenCalledWith('ay-active');
  });

  it('should throw NO_ACTIVE_ACADEMIC_YEAR when omitted and nothing is active', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(null);

    const failure = await service.findByAcademicYear().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BusinessException);
    expect((failure as BusinessException).code).toBe(ErrorCode.NO_ACTIVE_ACADEMIC_YEAR);
    expect(repo.findByAcademicYear).not.toHaveBeenCalled();
  });
});
