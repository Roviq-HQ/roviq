/**
 * ROV-167 — Unit tests for StudentAcademicService with its repository mocked (no DB).
 *
 * Focuses on the capacity-check branch of `enroll` / `changeSection`.
 */

import { ErrorCode } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentAcademicRepository } from '../repositories/student-academic.repository';
import type { SectionCapacityRecord } from '../repositories/types';
import { StudentAcademicService } from '../student-academic.service';

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

const NORMS = { optimal: 40, hardMax: 45, exemptionAllowed: true };

function capacity(currentStrength: number, cap: number): SectionCapacityRecord {
  return { section: { currentStrength, capacity: cap }, norms: NORMS };
}

const ENROL_INPUT = {
  studentProfileId: 'student-1',
  academicYearId: 'ay-1',
  standardId: 'std-1',
  sectionId: 'sec-1',
};

describe('StudentAcademicService (unit)', () => {
  let service: StudentAcademicService;
  let repository: ReturnType<typeof createMock<StudentAcademicRepository>>;
  let eventBus: ReturnType<typeof createMock<EventBusService>>;

  beforeEach(() => {
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    repository = createMock<StudentAcademicRepository>();
    service = new StudentAcademicService(repository, eventBus);
  });

  describe('enroll', () => {
    beforeEach(() => {
      repository.checkEnrolTarget.mockResolvedValue({ kind: 'ok' });
    });

    it('throws SECTION_CAPACITY_EXCEEDED when section is at hardMax and no overrideReason', async () => {
      repository.findSectionCapacity.mockResolvedValue(capacity(45, 45));

      await expect(service.enroll(ENROL_INPUT)).rejects.toMatchObject({
        code: ErrorCode.SECTION_CAPACITY_EXCEEDED,
      });
      expect(repository.createPlacement).not.toHaveBeenCalled();
    });

    it('rejects for capacity overflow', async () => {
      repository.findSectionCapacity.mockResolvedValue(capacity(50, 45));

      await expect(service.enroll(ENROL_INPUT)).rejects.toMatchObject({
        code: ErrorCode.SECTION_CAPACITY_EXCEEDED,
      });
    });

    it('succeeds past capacity when overrideReason is provided', async () => {
      repository.findSectionCapacity.mockResolvedValue(capacity(45, 45));
      repository.createPlacement.mockResolvedValue({ id: 'sa-1' });

      const result = await service.enroll({
        ...ENROL_INPUT,
        overrideReason: 'RTE admission requires seat',
      });

      expect(result).toEqual({ id: 'sa-1' });
      expect(repository.checkEnrolTarget).toHaveBeenCalledWith('tenant-1', {
        ...ENROL_INPUT,
        overrideReason: 'RTE admission requires seat',
      });
      expect(repository.createPlacement).toHaveBeenCalledWith('tenant-1', {
        ...ENROL_INPUT,
        actorId: 'user-1',
      });
      // Already past optimal (45 ≥ 40) before this placement: the warning went out on the crossing.
      expect(eventBus.emit).not.toHaveBeenCalledWith('SECTION.capacity_warning', expect.anything());
      expect(eventBus.emit).toHaveBeenCalledWith('STUDENT.enrolled', {
        studentProfileId: 'student-1',
        academicYearId: 'ay-1',
        sectionId: 'sec-1',
        tenantId: 'tenant-1',
      });
    });
  });

  describe('capacity warning, once per crossing (ROV-351)', () => {
    const WARNING = { sectionId: 'sec-1', currentStrength: 40, optimal: 40, tenantId: 'tenant-1' };

    beforeEach(() => {
      repository.checkEnrolTarget.mockResolvedValue({ kind: 'ok' });
      repository.createPlacement.mockResolvedValue({ id: 'sa-1' });
    });

    it('warns when a placement takes the section to its optimal strength', async () => {
      repository.findSectionCapacity.mockResolvedValue(capacity(39, 45));
      await service.enroll(ENROL_INPUT);
      expect(eventBus.emit).toHaveBeenCalledWith('SECTION.capacity_warning', WARNING);
      expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.section.capacity_warning', WARNING);
    });

    it('does not warn below the optimal strength or after it was already reached', async () => {
      for (const before of [10, 38, 40, 41]) {
        repository.findSectionCapacity.mockResolvedValue(capacity(before, 45));
        await service.enroll(ENROL_INPUT);
      }
      expect(eventBus.emit).not.toHaveBeenCalledWith('SECTION.capacity_warning', expect.anything());
      expect(eventBus.emit).not.toHaveBeenCalledWith(
        'NOTIFICATION.section.capacity_warning',
        expect.anything(),
      );
    });

    it('warns when a section change takes the new section to its optimal strength', async () => {
      repository.findPlacement.mockResolvedValue({
        id: 'sa-1',
        sectionId: 'sec-old',
        studentProfileId: 'student-1',
      });
      repository.findSectionCapacity.mockResolvedValue(capacity(39, 45));
      await service.changeSection({ studentAcademicId: 'sa-1', newSectionId: 'sec-1' });
      expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.section.capacity_warning', WARNING);
    });

    it('warns when a class change takes the new section to its optimal strength', async () => {
      repository.changeClass.mockImplementation(async (_tenantId, _data, rules) => {
        rules.assertCapacity(capacity(39, 45));
        return {
          kind: 'ok',
          row: {
            id: 'sa-1',
            studentProfileId: 'student-1',
            academicYearId: 'ay-1',
            standardId: 'std-old',
            sectionId: 'sec-old',
          },
        };
      });
      await service.changeClass({
        studentAcademicId: 'sa-1',
        standardId: 'std-1',
        sectionId: 'sec-1',
      });
      expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.section.capacity_warning', WARNING);
    });

    it('does not warn when a class change is refused for capacity', async () => {
      repository.changeClass.mockImplementation(async (_tenantId, _data, rules) => {
        rules.assertCapacity(capacity(45, 45));
        return { kind: 'academic_not_found' };
      });
      await expect(
        service.changeClass({ studentAcademicId: 'sa-1', standardId: 'std-1', sectionId: 'sec-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.SECTION_CAPACITY_EXCEEDED });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not warn when the student stays in the same section', async () => {
      repository.findPlacement.mockResolvedValue({
        id: 'sa-1',
        sectionId: 'sec-1',
        studentProfileId: 'student-1',
      });
      repository.findSectionCapacity.mockResolvedValue(capacity(39, 45));
      await service.changeSection({ studentAcademicId: 'sa-1', newSectionId: 'sec-1' });
      expect(eventBus.emit).not.toHaveBeenCalledWith(
        'NOTIFICATION.section.capacity_warning',
        expect.anything(),
      );
    });
  });

  describe('changeSection', () => {
    it('throws SECTION_CAPACITY_EXCEEDED when the target section is full', async () => {
      repository.findPlacement.mockResolvedValue({
        id: 'sa-1',
        sectionId: 'sec-old',
        studentProfileId: 'student-1',
      });
      repository.findSectionCapacity.mockResolvedValue(capacity(45, 45));

      await expect(
        service.changeSection({ studentAcademicId: 'sa-1', newSectionId: 'sec-new' }),
      ).rejects.toMatchObject({ code: ErrorCode.SECTION_CAPACITY_EXCEEDED });
      expect(repository.findSectionCapacity).toHaveBeenCalledWith('tenant-1', 'sec-new');
      expect(repository.setSection).not.toHaveBeenCalled();
    });

    it('rejects when the enrollment does not exist', async () => {
      repository.findPlacement.mockResolvedValue(null);

      await expect(
        service.changeSection({ studentAcademicId: 'missing', newSectionId: 'sec-new' }),
      ).rejects.toMatchObject({ code: ErrorCode.STUDENT_ACADEMIC_NOT_FOUND });
    });
  });
});
