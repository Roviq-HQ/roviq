import { BusinessException } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExaminationService } from '../examination.service';
import type { ExaminationRepository } from '../repositories/examination.repository';
import type { ExamScheduleRecord } from '../repositories/types';

function buildSchedule(overrides: Partial<ExamScheduleRecord> = {}): ExamScheduleRecord {
  return {
    id: 'sched-1',
    tenantId: 'tenant-1',
    examId: 'exam-1',
    sectionId: 'section-1',
    subjectId: 'subject-1',
    component: 'THEORY',
    examDate: '2026-06-01',
    startTime: '09:00',
    endTime: '12:00',
    maxMarks: 100,
    passMarks: 33,
    room: 'Hall A',
    invigilatorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ExaminationService room-clash validation', () => {
  let repo: ExaminationRepository;
  let service: ExaminationService;

  beforeEach(() => {
    repo = createMock<ExaminationRepository>({
      // No same-section clash — isolates the room check.
      findSchedulesByExamSection: vi.fn(async () => []),
      createSchedule: vi.fn(async (data) => buildSchedule({ ...data, id: 'new' })),
    });
    service = new ExaminationService(repo);
  });

  it('rejects a second paper in the same room at an overlapping time on the same date', async () => {
    vi.mocked(repo.findSchedulesByExam).mockResolvedValue([
      buildSchedule({ id: 'existing', sectionId: 'other-section', room: 'Hall A' }),
    ]);

    await expect(
      service.addSchedule({
        examId: 'exam-1',
        sectionId: 'section-2',
        subjectId: 'subject-2',
        component: 'THEORY',
        examDate: '2026-06-01',
        startTime: '10:00',
        endTime: '11:00',
        maxMarks: 100,
        room: 'Hall A',
      }),
    ).rejects.toThrow(BusinessException);
  });

  it('allows back-to-back papers in the same room (exclusive endpoints)', async () => {
    vi.mocked(repo.findSchedulesByExam).mockResolvedValue([
      buildSchedule({ id: 'existing', room: 'Hall A', startTime: '09:00', endTime: '12:00' }),
    ]);

    await expect(
      service.addSchedule({
        examId: 'exam-1',
        sectionId: 'section-2',
        subjectId: 'subject-2',
        component: 'THEORY',
        examDate: '2026-06-01',
        startTime: '12:00',
        endTime: '14:00',
        maxMarks: 100,
        room: 'Hall A',
      }),
    ).resolves.toBeDefined();
  });

  it('allows the same time slot in a different room', async () => {
    vi.mocked(repo.findSchedulesByExam).mockResolvedValue([
      buildSchedule({ id: 'existing', room: 'Hall A' }),
    ]);

    await expect(
      service.addSchedule({
        examId: 'exam-1',
        sectionId: 'section-2',
        subjectId: 'subject-2',
        component: 'THEORY',
        examDate: '2026-06-01',
        startTime: '09:00',
        endTime: '12:00',
        maxMarks: 100,
        room: 'Hall B',
      }),
    ).resolves.toBeDefined();
  });

  it('skips the room check when room is empty', async () => {
    vi.mocked(repo.findSchedulesByExam).mockResolvedValue([buildSchedule({ id: 'existing' })]);

    await service.addSchedule({
      examId: 'exam-1',
      sectionId: 'section-2',
      subjectId: 'subject-2',
      component: 'THEORY',
      examDate: '2026-06-01',
      startTime: '09:00',
      endTime: '12:00',
      maxMarks: 100,
      room: null,
    });

    expect(repo.findSchedulesByExam).not.toHaveBeenCalled();
  });
});
