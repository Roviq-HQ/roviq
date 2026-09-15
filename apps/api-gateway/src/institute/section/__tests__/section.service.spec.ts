import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicYearRepository } from '../../academic-year/repositories/academic-year.repository';
import type { AcademicYearRecord } from '../../academic-year/repositories/types';
import type { SectionRepository } from '../repositories/section.repository';
import type { SectionRecord } from '../repositories/types';
import { SectionService } from '../section.service';
import type { StandardRepository } from '../standard/repositories/standard.repository';

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

function sectionRec(over: Partial<SectionRecord> = {}): SectionRecord {
  return {
    id: 'sec-1',
    tenantId: 'tenant',
    standardId: 'std-1',
    academicYearId: 'ay-active',
    name: { en: 'A' },
    displayLabel: 'A',
    stream: null,
    mediumOfInstruction: null,
    shift: null,
    classTeacherId: null,
    room: null,
    capacity: null,
    currentStrength: 0,
    genderRestriction: 'CO_ED',
    displayOrder: 1,
    startTime: null,
    endTime: null,
    batchStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// An omitted year means the current session (the single ACTIVE year);
// an explicit year passes through for planning flows on other years.
describe('SectionService.findByAcademicYear', () => {
  let repo: SectionRepository;
  let academicYearRepo: AcademicYearRepository;
  let service: SectionService;

  beforeEach(() => {
    repo = createMock<SectionRepository>();
    academicYearRepo = createMock<AcademicYearRepository>();
    service = new SectionService(
      repo,
      createMock<StandardRepository>(),
      createMock<EventBusService>(),
      academicYearRepo,
    );
  });

  it('should pass an explicit year straight through to the repository', async () => {
    const rows = [sectionRec()];
    vi.mocked(repo.findByAcademicYear).mockResolvedValue(rows);

    await expect(service.findByAcademicYear('ay-planning')).resolves.toBe(rows);
    expect(repo.findByAcademicYear).toHaveBeenCalledWith('ay-planning');
    expect(academicYearRepo.findActive).not.toHaveBeenCalled();
  });

  it('should resolve an omitted year to the active year', async () => {
    vi.mocked(academicYearRepo.findActive).mockResolvedValue(yearRec({ id: 'ay-active' }));
    const rows = [sectionRec()];
    vi.mocked(repo.findByAcademicYear).mockResolvedValue(rows);

    await expect(service.findByAcademicYear()).resolves.toBe(rows);
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
