import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessException, ErrorCode, type Weekday } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { TimetableRepository } from './repositories/timetable.repository';
import type { TimetableEntryRecord } from './repositories/types';

/** One parallel group within a cell (whole class = single split with index 0). */
export interface AssignSplitInput {
  splitIndex: number;
  splitLabel?: string | null;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
}

export interface AssignEntryServiceInput {
  timetableId: string;
  sectionId: string;
  periodId: string;
  /** Apply the same splits to each of these weekdays (day-split is separate calls). */
  days: Weekday[];
  splits: AssignSplitInput[];
}

export interface ClearEntryServiceInput {
  timetableId: string;
  sectionId: string;
  periodId: string;
  dayOfWeek: Weekday;
  splitIndex: number;
}

@Injectable()
export class TimetableScheduleService {
  constructor(
    private readonly repo: TimetableRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Assign subject/teacher/room to a cell for one or more weekdays, supporting
   * class-split (multiple parallel groups in the same slot). Validates the
   * whole batch — period is assignable, section is covered, and no teacher or
   * room is double-booked (against DB state AND within this batch) — before any
   * write. The DB partial-unique on teacher is the hard backstop.
   */
  async assignEntry(input: AssignEntryServiceInput): Promise<TimetableEntryRecord[]> {
    const timetable = await this.repo.findTimetableById(input.timetableId);
    if (!timetable) throw new NotFoundException(`Timetable ${input.timetableId} not found`);

    const period = await this.assertAssignableTarget(input);

    const result: TimetableEntryRecord[] = [];
    for (const dayOfWeek of input.days) {
      await this.assertNoSlotConflicts(input, period, dayOfWeek);
      for (const split of input.splits) {
        result.push(
          await this.repo.upsertEntry({
            timetableId: input.timetableId,
            sectionId: input.sectionId,
            periodId: input.periodId,
            dayOfWeek,
            splitIndex: split.splitIndex,
            splitLabel: split.splitLabel ?? null,
            subjectId: split.subjectId ?? null,
            teacherId: split.teacherId ?? null,
            room: split.room ?? null,
          }),
        );
      }
    }

    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.entry_assigned, {
      timetableId: input.timetableId,
      tenantId: timetable.tenantId,
      sectionId: input.sectionId,
      periodId: input.periodId,
    });
    return result;
  }

  /** Validate the period is assignable and the section is covered; returns the period. */
  private async assertAssignableTarget(input: AssignEntryServiceInput) {
    const period = await this.repo.findPeriodById(input.periodId);
    if (!period || period.timetableId !== input.timetableId) {
      throw new NotFoundException(`Period ${input.periodId} not found in this timetable`);
    }
    if (period.kind === 'BREAK') {
      throw new BusinessException(
        ErrorCode.TIMETABLE_PERIOD_NOT_ASSIGNABLE,
        'A break period cannot hold a subject or teacher.',
      );
    }
    const sections = await this.repo.findSections(input.timetableId);
    if (!sections.some((s) => s.sectionId === input.sectionId)) {
      throw new BusinessException(
        ErrorCode.TIMETABLE_SECTION_NOT_COVERED,
        'This section is not part of the timetable.',
      );
    }
    return period;
  }

  /** Reject teacher / room double-booking for one weekday — against DB state AND within the batch. */
  private async assertNoSlotConflicts(
    input: AssignEntryServiceInput,
    period: { label: string },
    dayOfWeek: Weekday,
  ): Promise<void> {
    const targetSplitIndices = new Set(input.splits.map((s) => s.splitIndex));
    const slot = await this.repo.findEntriesAtSlot(input.timetableId, input.periodId, dayOfWeek);
    // Existing cells in this slot that we are NOT overwriting in this call.
    const teachers = new Set<string>();
    const rooms = new Set<string>();
    for (const e of slot) {
      if (e.sectionId === input.sectionId && targetSplitIndices.has(e.splitIndex)) continue;
      if (e.teacherId) teachers.add(e.teacherId);
      if (e.room) rooms.add(e.room);
    }

    for (const split of input.splits) {
      if (split.teacherId) {
        if (teachers.has(split.teacherId)) {
          throw new BusinessException(
            ErrorCode.TIMETABLE_TEACHER_CONFLICT,
            `Teacher is already assigned elsewhere in period "${period.label}" on ${dayOfWeek}.`,
          );
        }
        teachers.add(split.teacherId);
      }
      if (split.room) {
        if (rooms.has(split.room)) {
          throw new BusinessException(
            ErrorCode.TIMETABLE_ROOM_CONFLICT,
            `Room "${split.room}" is already in use in period "${period.label}" on ${dayOfWeek}.`,
          );
        }
        rooms.add(split.room);
      }
    }
  }

  async clearEntry(input: ClearEntryServiceInput): Promise<boolean> {
    const timetable = await this.repo.findTimetableById(input.timetableId);
    if (!timetable) throw new NotFoundException(`Timetable ${input.timetableId} not found`);
    await this.repo.clearEntry({
      timetableId: input.timetableId,
      sectionId: input.sectionId,
      periodId: input.periodId,
      dayOfWeek: input.dayOfWeek,
      splitIndex: input.splitIndex,
    });
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.entry_cleared, {
      timetableId: input.timetableId,
      tenantId: timetable.tenantId,
      sectionId: input.sectionId,
      periodId: input.periodId,
    });
    return true;
  }
}
