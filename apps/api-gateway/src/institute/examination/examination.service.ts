import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  EXAM_STATE_MACHINE,
  type ExamStatus,
} from '@roviq/common-types';
import { ExaminationRepository } from './repositories/examination.repository';
import type {
  CreateExamData,
  CreateExamScheduleData,
  ExamRecord,
  ExamScheduleRecord,
  ListExamsQuery,
  PaginatedExams,
  UpdateExamData,
  UpdateExamScheduleData,
} from './repositories/types';

/** Exam master CRUD, named lifecycle transitions, and the datesheet (schedules). */
@Injectable()
export class ExaminationService {
  constructor(private readonly repo: ExaminationRepository) {}

  // ── Exam master ──────────────────────────────────────────────────────────

  createExam(data: CreateExamData): Promise<ExamRecord> {
    return this.repo.createExam(data);
  }

  async getExam(id: string): Promise<ExamRecord> {
    const exam = await this.repo.findExamById(id);
    if (!exam) throw new BusinessException(ErrorCode.EXAM_NOT_FOUND, `Exam ${id} not found`);
    return exam;
  }

  listExams(query: ListExamsQuery): Promise<PaginatedExams> {
    return this.repo.listExams(query);
  }

  updateExam(id: string, data: UpdateExamData): Promise<ExamRecord> {
    return this.repo.updateExam(id, data);
  }

  // ── Named lifecycle transitions (ROV-249) ──────────────────────────────────

  scheduleExam(id: string): Promise<ExamRecord> {
    return this.transition(id, 'SCHEDULED');
  }

  openMarksEntry(id: string): Promise<ExamRecord> {
    return this.transition(id, 'MARKS_ENTRY');
  }

  lockExam(id: string): Promise<ExamRecord> {
    return this.transition(id, 'LOCKED');
  }

  publishResults(id: string): Promise<ExamRecord> {
    return this.transition(id, 'RESULTS_PUBLISHED');
  }

  archiveExam(id: string): Promise<ExamRecord> {
    return this.transition(id, 'ARCHIVED');
  }

  // Reverse an archive: restore the exam to its published state.
  unarchive(id: string): Promise<ExamRecord> {
    return this.transition(id, 'RESULTS_PUBLISHED');
  }

  private async transition(id: string, to: ExamStatus): Promise<ExamRecord> {
    const exam = await this.getExam(id);
    EXAM_STATE_MACHINE.assertTransition(exam.status, to);
    return this.repo.setExamStatus(id, to);
  }

  delete(id: string): Promise<void> {
    return this.repo.softDeleteExam(id);
  }

  restore(id: string): Promise<ExamRecord> {
    return this.repo.restoreExam(id);
  }

  // ── Datesheet (schedules) ────────────────────────────────────────────────

  async addSchedule(data: CreateExamScheduleData): Promise<ExamScheduleRecord> {
    await this.assertNoClash(
      data.examId,
      data.sectionId,
      data.examDate,
      data.startTime,
      data.endTime,
    );
    await this.assertNoRoomClash(
      data.examId,
      data.room,
      data.examDate,
      data.startTime,
      data.endTime,
    );
    return this.repo.createSchedule(data);
  }

  async updateSchedule(id: string, data: UpdateExamScheduleData): Promise<ExamScheduleRecord> {
    const current = await this.repo.findScheduleById(id);
    if (!current)
      throw new BusinessException(ErrorCode.EXAM_NOT_FOUND, `Datesheet row ${id} not found`);
    // Resolve effective values: partial update keeps current fields when omitted.
    const examDate = data.examDate !== undefined ? data.examDate : current.examDate;
    const startTime = data.startTime !== undefined ? data.startTime : current.startTime;
    const endTime = data.endTime !== undefined ? data.endTime : current.endTime;
    const room = data.room !== undefined ? data.room : current.room;
    await this.assertNoClash(current.examId, current.sectionId, examDate, startTime, endTime, id);
    await this.assertNoRoomClash(current.examId, room, examDate, startTime, endTime, id);
    return this.repo.updateSchedule(id, data);
  }

  /** A section can't sit two papers at once: reject same-section, same-date time overlap. */
  private async assertNoClash(
    examId: string,
    sectionId: string,
    examDate: string | null | undefined,
    startTime: string | null | undefined,
    endTime: string | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    // Null times = unscheduled slot, treated as no clash.
    if (!examDate || !startTime || !endTime) return;
    const existing = await this.repo.findSchedulesByExamSection(examId, sectionId);
    const clash = existing.some(
      (s) =>
        s.id !== excludeId &&
        s.examDate === examDate &&
        s.startTime != null &&
        s.endTime != null &&
        timesOverlap(startTime, endTime, s.startTime, s.endTime),
    );
    if (clash)
      throw new BusinessException(
        ErrorCode.EXAM_INVALID_CONFIG,
        'Datesheet clash: section already has a paper at this time',
      );
  }

  /** A room can't host two papers at once: reject same-room, same-date time overlap across the whole exam. */
  private async assertNoRoomClash(
    examId: string,
    room: string | null | undefined,
    examDate: string | null | undefined,
    startTime: string | null | undefined,
    endTime: string | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    // No room or null times = nothing to clash against.
    if (!room || !examDate || !startTime || !endTime) return;
    const existing = await this.repo.findSchedulesByExam(examId);
    const clash = existing.some(
      (s) =>
        s.id !== excludeId &&
        s.room === room &&
        s.examDate === examDate &&
        s.startTime != null &&
        s.endTime != null &&
        timesOverlap(startTime, endTime, s.startTime, s.endTime),
    );
    if (clash)
      throw new BusinessException(
        ErrorCode.EXAM_INVALID_CONFIG,
        `Room clash: ${room} is already booked at this time`,
      );
  }

  removeSchedule(id: string): Promise<void> {
    return this.repo.softDeleteSchedule(id);
  }

  listSchedules(examId: string): Promise<ExamScheduleRecord[]> {
    return this.repo.findSchedulesByExam(examId);
  }
}

// Zero-padded HH:MM strings compare lexically; back-to-back papers (end == start) don't clash.
function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
}
