import { Injectable, NotFoundException } from '@nestjs/common';
import { type TimetableOverrideType, WEEKDAY_BY_JS_DAY, type Weekday } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { TimetableRepository } from './repositories/timetable.repository';
import type {
  TimetableDayOverrideRecord,
  TimetableEntryRecord,
  TimetablePeriodRecord,
  TimetableRecord,
} from './repositories/types';

/** A section or staff weekly grid: the period rows, the working days, and the cells. */
export interface TimetableGrid {
  timetableId: string;
  periods: TimetablePeriodRecord[];
  workingDays: Weekday[];
  entries: TimetableEntryRecord[];
}

/** A single resolved cell for a specific date (master entry with overrides applied). */
export interface DayScheduleSlot {
  periodId: string;
  label: string;
  kind: TimetablePeriodRecord['kind'];
  startTime: string;
  endTime: string;
  splitIndex: number;
  splitLabel: string | null;
  sectionId: string;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
  isOverride: boolean;
  overrideType: TimetableOverrideType | null;
}

export interface DaySchedule {
  date: string;
  dayOfWeek: Weekday;
  sectionId: string;
  timetableId: string | null;
  slots: DayScheduleSlot[];
}

export interface CreateOverrideServiceInput {
  timetableId: string;
  date: string;
  sectionId: string;
  periodId: string;
  splitIndex: number;
  overrideType: TimetableOverrideType;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
  reason?: string | null;
}

/** YYYY-MM-DD → Weekday, parsed as UTC so it never shifts across timezones. */
function weekdayOf(dateIso: string): Weekday {
  const jsDay = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  const weekday = WEEKDAY_BY_JS_DAY[jsDay];
  if (!weekday) throw new NotFoundException(`Invalid date "${dateIso}"`);
  return weekday;
}

@Injectable()
export class TimetableViewService {
  constructor(
    private readonly repo: TimetableRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** Resolve the timetable to view: the explicit one, else the active one covering the section. */
  private async resolveForSection(
    sectionId: string,
    timetableId?: string,
  ): Promise<TimetableRecord | null> {
    if (timetableId) return this.repo.findTimetableById(timetableId);
    const page = await this.repo.listTimetables({
      sectionId,
      status: 'ACTIVE',
      page: 1,
      perPage: 1,
    });
    return page.docs[0] ?? null;
  }

  async sectionTimetable(sectionId: string, timetableId?: string): Promise<TimetableGrid | null> {
    const timetable = await this.resolveForSection(sectionId, timetableId);
    if (!timetable) return null;
    const [periods, entries] = await Promise.all([
      this.repo.findPeriods(timetable.id),
      this.repo.findEntriesBySection(timetable.id, sectionId),
    ]);
    return { timetableId: timetable.id, periods, workingDays: timetable.workingDays, entries };
  }

  async staffTimetable(teacherId: string, timetableId?: string): Promise<TimetableGrid | null> {
    const timetable = timetableId
      ? await this.repo.findTimetableById(timetableId)
      : ((await this.repo.listTimetables({ status: 'ACTIVE', page: 1, perPage: 1 })).docs[0] ??
        null);
    if (!timetable) return null;
    const [periods, entries] = await Promise.all([
      this.repo.findPeriods(timetable.id),
      this.repo.findEntriesByTeacher(timetable.id, teacherId),
    ]);
    return { timetableId: timetable.id, periods, workingDays: timetable.workingDays, entries };
  }

  async daySchedule(date: string, sectionId: string, timetableId?: string): Promise<DaySchedule> {
    const dayOfWeek = weekdayOf(date);
    const timetable = await this.resolveForSection(sectionId, timetableId);
    if (!timetable || !this.isActiveDay(timetable, date, dayOfWeek)) {
      return { date, dayOfWeek, sectionId, timetableId: timetable?.id ?? null, slots: [] };
    }

    const [periods, entries, overrides] = await Promise.all([
      this.repo.findPeriods(timetable.id),
      this.repo.findEntriesBySection(timetable.id, sectionId),
      this.repo.findOverridesByDate(timetable.id, date),
    ]);

    const dayEntries = entries.filter((e) => e.dayOfWeek === dayOfWeek);
    const sectionOverrides = overrides.filter((o) => o.sectionId === sectionId);
    const slots = this.buildSlots(sectionId, periods, dayEntries, sectionOverrides);
    return { date, dayOfWeek, sectionId, timetableId: timetable.id, slots };
  }

  async staffDaySchedule(date: string, teacherId: string): Promise<DayScheduleSlot[]> {
    const dayOfWeek = weekdayOf(date);
    const grid = await this.staffTimetable(teacherId);
    if (!grid) return [];
    const periodById = new Map(grid.periods.map((p) => [p.id, p]));
    const slots: DayScheduleSlot[] = [];
    for (const entry of grid.entries.filter((e) => e.dayOfWeek === dayOfWeek)) {
      const period = periodById.get(entry.periodId);
      if (!period) continue;
      slots.push(this.slotFromEntry(period, entry, false, null));
    }
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return slots;
  }

  async createOverride(input: CreateOverrideServiceInput): Promise<TimetableDayOverrideRecord> {
    const timetable = await this.repo.findTimetableById(input.timetableId);
    if (!timetable) throw new NotFoundException(`Timetable ${input.timetableId} not found`);

    // Snapshot the master cell so history survives later master edits.
    const dayOfWeek = weekdayOf(input.date);
    const entries = await this.repo.findEntriesBySection(input.timetableId, input.sectionId);
    const master = entries.find(
      (e) =>
        e.periodId === input.periodId &&
        e.dayOfWeek === dayOfWeek &&
        e.splitIndex === input.splitIndex,
    );

    const override = await this.repo.createOverride({
      timetableId: input.timetableId,
      date: input.date,
      sectionId: input.sectionId,
      periodId: input.periodId,
      splitIndex: input.splitIndex,
      overrideType: input.overrideType,
      subjectId: input.subjectId ?? null,
      teacherId: input.teacherId ?? null,
      room: input.room ?? null,
      originalSubjectId: master?.subjectId ?? null,
      originalTeacherId: master?.teacherId ?? null,
      reason: input.reason ?? null,
    });
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.day_overridden, {
      overrideId: override.id,
      timetableId: input.timetableId,
      tenantId: timetable.tenantId,
      sectionId: input.sectionId,
      date: input.date,
    });
    return override;
  }

  listOverrides(timetableId: string, date: string): Promise<TimetableDayOverrideRecord[]> {
    return this.repo.findOverridesByDate(timetableId, date);
  }

  async clearOverride(id: string): Promise<boolean> {
    const override = await this.repo.findOverrideById(id);
    if (!override) throw new NotFoundException(`Override ${id} not found`);
    await this.repo.softDeleteOverride(id);
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.override_cleared, {
      overrideId: id,
      timetableId: override.timetableId,
      tenantId: override.tenantId,
    });
    return true;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private isActiveDay(timetable: TimetableRecord, date: string, dayOfWeek: Weekday): boolean {
    return (
      date >= timetable.effectiveFrom &&
      date <= timetable.effectiveTo &&
      timetable.workingDays.includes(dayOfWeek)
    );
  }

  private slotFromEntry(
    period: TimetablePeriodRecord,
    entry: TimetableEntryRecord,
    isOverride: boolean,
    overrideType: TimetableOverrideType | null,
  ): DayScheduleSlot {
    return {
      periodId: period.id,
      label: period.label,
      kind: period.kind,
      startTime: period.startTime,
      endTime: period.endTime,
      splitIndex: entry.splitIndex,
      splitLabel: entry.splitLabel,
      sectionId: entry.sectionId,
      subjectId: entry.subjectId,
      teacherId: entry.teacherId,
      room: entry.room,
      isOverride,
      overrideType,
    };
  }

  /** Build the ordered day slots: master cells per period with overrides layered on. */
  private buildSlots(
    sectionId: string,
    periods: TimetablePeriodRecord[],
    dayEntries: TimetableEntryRecord[],
    overrides: TimetableDayOverrideRecord[],
  ): DayScheduleSlot[] {
    const slots: DayScheduleSlot[] = [];
    const sorted = [...periods].sort((a, b) => a.sequence - b.sequence);

    for (const period of sorted) {
      if (period.kind === 'BREAK') {
        slots.push({
          periodId: period.id,
          label: period.label,
          kind: 'BREAK',
          startTime: period.startTime,
          endTime: period.endTime,
          splitIndex: 0,
          splitLabel: null,
          sectionId,
          subjectId: null,
          teacherId: null,
          room: null,
          isOverride: false,
          overrideType: null,
        });
        continue;
      }

      const cells = new Map(
        dayEntries.filter((e) => e.periodId === period.id).map((e) => [e.splitIndex, e]),
      );
      const periodOverrides = new Map(
        overrides.filter((o) => o.periodId === period.id).map((o) => [o.splitIndex, o]),
      );
      const splitIndices = new Set<number>([...cells.keys(), ...periodOverrides.keys()]);

      if (splitIndices.size === 0) {
        // Vacant period — still render the row so the day grid is complete.
        slots.push({
          periodId: period.id,
          label: period.label,
          kind: period.kind,
          startTime: period.startTime,
          endTime: period.endTime,
          splitIndex: 0,
          splitLabel: null,
          sectionId,
          subjectId: null,
          teacherId: null,
          room: null,
          isOverride: false,
          overrideType: null,
        });
        continue;
      }

      for (const splitIndex of [...splitIndices].sort((a, b) => a - b)) {
        const base = cells.get(splitIndex);
        const ov = periodOverrides.get(splitIndex);
        if (ov?.overrideType === 'CANCELLATION') continue; // free period that day

        slots.push({
          periodId: period.id,
          label: period.label,
          kind: period.kind,
          startTime: period.startTime,
          endTime: period.endTime,
          splitIndex,
          splitLabel: base?.splitLabel ?? null,
          sectionId,
          subjectId: ov?.subjectId ?? base?.subjectId ?? null,
          teacherId: ov?.teacherId ?? base?.teacherId ?? null,
          room: ov?.room ?? base?.room ?? null,
          isOverride: Boolean(ov),
          overrideType: ov?.overrideType ?? null,
        });
      }
    }
    return slots;
  }
}
