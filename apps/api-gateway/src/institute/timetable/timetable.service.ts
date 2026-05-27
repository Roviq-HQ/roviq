import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  isValidDateRange,
  TIMETABLE_STATE_MACHINE,
  type Weekday,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { TimetableRepository } from './repositories/timetable.repository';
import type {
  ListTimetablesQuery,
  PaginatedTimetables,
  TimetablePeriodRecord,
  TimetableRecord,
  TimetableSectionRecord,
  TimetableStatisticsRow,
} from './repositories/types';
import { TimetableGenerationService } from './timetable-generation.service';

/** Service-layer input for creating a timetable + generating its grid. */
export interface CreateTimetableServiceInput {
  academicYearId: string;
  name: Record<string, string>;
  description?: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  workingDays: Weekday[];
  dayStartTime: string;
  defaultPeriodDurationMins: number;
  periodsCount: number;
  sectionIds: string[];
  lunch: { name: string; afterPeriod: number; durationMins: number }[];
  extraClass: {
    session: 'MORNING' | 'EVENING';
    startTime: string;
    durationMins: number;
    count: number;
  }[];
}

export interface UpdateTimetableServiceInput {
  name?: Record<string, string>;
  description?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string;
  workingDays?: Weekday[];
}

export interface AddPeriodServiceInput {
  timetableId: string;
  kind: 'PERIOD' | 'EXTRA' | 'BREAK';
  label?: string;
  startTime?: string;
  durationMins?: number;
  session?: 'MORNING' | 'MAIN' | 'EVENING';
}

function isNameDuplicate(err: unknown): boolean {
  return String((err as { message?: string })?.message ?? err).includes(
    'timetables_tenant_year_name_key',
  );
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly repo: TimetableRepository,
    private readonly generation: TimetableGenerationService,
    private readonly eventBus: EventBusService,
  ) {}

  private tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new BusinessException(ErrorCode.FORBIDDEN, 'Tenant context required');
    return tenantId;
  }

  async create(input: CreateTimetableServiceInput): Promise<TimetableRecord> {
    if (!isValidDateRange(input.effectiveFrom, input.effectiveTo)) {
      throw new BusinessException(
        ErrorCode.INVALID_DATE_RANGE,
        'Timetable end date must be on or after the start date.',
      );
    }
    if (input.sectionIds.length === 0) {
      throw new BusinessException(
        ErrorCode.TIMETABLE_INVALID_CONFIG,
        'A timetable must cover at least one section.',
      );
    }

    // Build the grid up-front so an invalid config fails before any write.
    const periods = this.generation.generatePeriods({
      dayStartTime: input.dayStartTime,
      periodDurationMins: input.defaultPeriodDurationMins,
      periodsCount: input.periodsCount,
      lunch: input.lunch,
      extraClass: input.extraClass,
    });

    let timetable: TimetableRecord;
    try {
      // Atomic: timetable + sections + period grid in one transaction.
      timetable = await this.repo.createWithGrid(
        {
          academicYearId: input.academicYearId,
          name: input.name,
          description: input.description ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          workingDays: input.workingDays,
          dayStartTime: input.dayStartTime,
          defaultPeriodDurationMins: input.defaultPeriodDurationMins,
        },
        input.sectionIds,
        periods,
      );
    } catch (err) {
      if (isNameDuplicate(err)) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_NAME_DUPLICATE,
          'A timetable with this name already exists in this academic year.',
        );
      }
      throw err;
    }

    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.created, {
      timetableId: timetable.id,
      tenantId: timetable.tenantId,
      academicYearId: timetable.academicYearId,
    });
    return timetable;
  }

  async findById(id: string): Promise<TimetableRecord> {
    const record = await this.repo.findTimetableById(id);
    if (!record) throw new NotFoundException(`Timetable ${id} not found`);
    return record;
  }

  list(query: ListTimetablesQuery): Promise<PaginatedTimetables> {
    return this.repo.listTimetables(query);
  }

  statistics(academicYearId?: string): Promise<TimetableStatisticsRow> {
    return this.repo.statistics(academicYearId);
  }

  getPeriods(timetableId: string): Promise<TimetablePeriodRecord[]> {
    return this.repo.findPeriods(timetableId);
  }

  getSections(timetableId: string): Promise<TimetableSectionRecord[]> {
    return this.repo.findSections(timetableId);
  }

  async update(id: string, input: UpdateTimetableServiceInput): Promise<TimetableRecord> {
    await this.findById(id);
    if (
      input.effectiveFrom !== undefined &&
      input.effectiveTo !== undefined &&
      !isValidDateRange(input.effectiveFrom, input.effectiveTo)
    ) {
      throw new BusinessException(
        ErrorCode.INVALID_DATE_RANGE,
        'Timetable end date must be on or after the start date.',
      );
    }
    let updated: TimetableRecord;
    try {
      updated = await this.repo.updateTimetable(id, input);
    } catch (err) {
      if (isNameDuplicate(err)) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_NAME_DUPLICATE,
          'A timetable with this name already exists in this academic year.',
        );
      }
      throw err;
    }
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.updated, {
      timetableId: updated.id,
      tenantId: updated.tenantId,
    });
    return updated;
  }

  // ── Status transitions (named domain mutations) ──────────────────────────

  async activate(id: string): Promise<TimetableRecord> {
    const current = await this.findById(id);
    TIMETABLE_STATE_MACHINE.assertTransition(current.status, 'ACTIVE');
    let result: { timetable: TimetableRecord; previousActiveId: string | null };
    try {
      result = await this.repo.activateExclusive(id, current.academicYearId);
    } catch (err) {
      // Partial-unique backstop — should be unreachable given the swap, but
      // surface a clean business error if a race slips through.
      throw new BusinessException(
        ErrorCode.TIMETABLE_ALREADY_ACTIVE,
        `Another timetable is already active for this academic year: ${String(err)}`,
      );
    }
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.activated, {
      timetableId: result.timetable.id,
      tenantId: result.timetable.tenantId,
      academicYearId: result.timetable.academicYearId,
      previousActiveId: result.previousActiveId,
    });
    return result.timetable;
  }

  async deactivate(id: string): Promise<TimetableRecord> {
    const current = await this.findById(id);
    TIMETABLE_STATE_MACHINE.assertTransition(current.status, 'INACTIVE');
    const updated = await this.repo.setStatus(id, 'INACTIVE');
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.deactivated, {
      timetableId: updated.id,
      tenantId: updated.tenantId,
    });
    return updated;
  }

  async archive(id: string): Promise<TimetableRecord> {
    const current = await this.findById(id);
    TIMETABLE_STATE_MACHINE.assertTransition(current.status, 'ARCHIVED');
    const updated = await this.repo.setStatus(id, 'ARCHIVED');
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.archived, {
      timetableId: updated.id,
      tenantId: updated.tenantId,
    });
    return updated;
  }

  async delete(ids: string[]): Promise<number> {
    const tenantId = this.tenantId();
    for (const id of ids) {
      await this.repo.softDeleteTimetable(id);
      this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.deleted, { timetableId: id, tenantId });
    }
    return ids.length;
  }

  async restore(ids: string[]): Promise<number> {
    for (const id of ids) {
      const restored = await this.repo.restoreTimetable(id);
      this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.restored, {
        timetableId: restored.id,
        tenantId: restored.tenantId,
      });
    }
    return ids.length;
  }

  // ── Covered sections ──────────────────────────────────────────────────────

  async addSection(timetableId: string, sectionId: string): Promise<TimetableSectionRecord> {
    const timetable = await this.findById(timetableId);
    const record = await this.repo.addSection(timetableId, sectionId);
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.section_added, {
      timetableId,
      tenantId: timetable.tenantId,
      sectionId,
    });
    return record;
  }

  async removeSection(timetableId: string, sectionId: string): Promise<boolean> {
    const timetable = await this.findById(timetableId);
    await this.repo.removeSection(timetableId, sectionId);
    // Clear this section's assignment cells so the grid stays consistent.
    const entries = await this.repo.findEntriesBySection(timetableId, sectionId);
    for (const entry of entries) {
      await this.repo.clearEntry({
        timetableId,
        sectionId,
        periodId: entry.periodId,
        dayOfWeek: entry.dayOfWeek,
        splitIndex: entry.splitIndex,
      });
    }
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.section_removed, {
      timetableId,
      tenantId: timetable.tenantId,
      sectionId,
    });
    return true;
  }

  // ── Periods ───────────────────────────────────────────────────────────────

  async addPeriod(input: AddPeriodServiceInput): Promise<TimetablePeriodRecord> {
    const timetable = await this.findById(input.timetableId);
    const existing = await this.repo.findPeriods(input.timetableId);
    const nextSequence = existing.reduce((max, p) => Math.max(max, p.sequence), 0) + 1;

    // Default: append after the last MAIN period using the timetable's duration.
    const lastMain = [...existing].reverse().find((p) => p.session === 'MAIN');
    const startTime = input.startTime ?? lastMain?.endTime ?? timetable.dayStartTime;
    const durationMins = input.durationMins ?? timetable.defaultPeriodDurationMins;
    const generated = this.generation.generatePeriods({
      dayStartTime: startTime,
      periodDurationMins: durationMins,
      periodsCount: 1,
      lunch: [],
      extraClass: [],
    });
    const slot = generated[0];
    if (!slot) {
      throw new BusinessException(ErrorCode.TIMETABLE_INVALID_CONFIG, 'Could not compute period.');
    }

    const regularCount = existing.filter((p) => p.kind === 'PERIOD').length;
    const label = input.label ?? (input.kind === 'PERIOD' ? String(regularCount + 1) : slot.label);
    const [created] = await this.repo.createPeriods([
      {
        timetableId: input.timetableId,
        kind: input.kind,
        label,
        sequence: nextSequence,
        startTime: slot.startTime,
        endTime: slot.endTime,
        session: input.session ?? (input.kind === 'PERIOD' ? 'MAIN' : 'EVENING'),
      },
    ]);
    if (!created) {
      throw new BusinessException(ErrorCode.TIMETABLE_INVALID_CONFIG, 'Failed to add period.');
    }
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.period_added, {
      timetableId: input.timetableId,
      tenantId: timetable.tenantId,
      periodId: created.id,
    });
    return created;
  }

  async updatePeriod(
    timetableId: string,
    periodId: string,
    input: { label?: string; startTime?: string; endTime?: string },
  ): Promise<TimetablePeriodRecord> {
    const timetable = await this.findById(timetableId);
    const updated = await this.repo.updatePeriod(periodId, input);
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.updated, {
      timetableId,
      tenantId: timetable.tenantId,
    });
    return updated;
  }

  async removePeriod(timetableId: string, periodId: string): Promise<boolean> {
    const timetable = await this.findById(timetableId);
    // Clear the period's assignment cells, then soft-delete the period.
    const entries = await this.repo.findEntriesByTimetable(timetableId);
    for (const entry of entries.filter((e) => e.periodId === periodId)) {
      await this.repo.clearEntry({
        timetableId,
        sectionId: entry.sectionId,
        periodId,
        dayOfWeek: entry.dayOfWeek,
        splitIndex: entry.splitIndex,
      });
    }
    await this.repo.softDeletePeriod(periodId);
    this.eventBus.emit(EVENT_PATTERNS.TIMETABLE.period_removed, {
      timetableId,
      tenantId: timetable.tenantId,
      periodId,
    });
    return true;
  }
}
