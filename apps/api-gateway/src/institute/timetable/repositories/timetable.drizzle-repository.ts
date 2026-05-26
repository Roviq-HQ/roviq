import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Weekday } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  softDelete,
  timetableDayOverrides,
  timetableDayOverridesLive,
  timetableEntries,
  timetableEntriesLive,
  timetablePeriods,
  timetablePeriodsLive,
  timetableSections,
  timetableSectionsLive,
  timetables,
  timetablesLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, between, count, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { TimetableRepository } from './timetable.repository';
import type {
  ClearEntryQuery,
  CreateOverrideData,
  CreatePeriodData,
  CreateTimetableData,
  ListTimetablesQuery,
  PaginatedTimetables,
  TimetableDayOverrideRecord,
  TimetableEntryRecord,
  TimetablePeriodRecord,
  TimetableRecord,
  TimetableSectionRecord,
  TimetableStatisticsRow,
  UpdatePeriodData,
  UpdateTimetableData,
  UpsertEntryData,
} from './types';

const timetableLiveColumns = {
  id: timetablesLive.id,
  tenantId: timetablesLive.tenantId,
  academicYearId: timetablesLive.academicYearId,
  name: timetablesLive.name,
  description: timetablesLive.description,
  status: timetablesLive.status,
  effectiveFrom: timetablesLive.effectiveFrom,
  effectiveTo: timetablesLive.effectiveTo,
  workingDays: timetablesLive.workingDays,
  dayStartTime: timetablesLive.dayStartTime,
  defaultPeriodDurationMins: timetablesLive.defaultPeriodDurationMins,
  createdAt: timetablesLive.createdAt,
  updatedAt: timetablesLive.updatedAt,
} as const;

const timetableWriteReturning = {
  id: timetables.id,
  tenantId: timetables.tenantId,
  academicYearId: timetables.academicYearId,
  name: timetables.name,
  description: timetables.description,
  status: timetables.status,
  effectiveFrom: timetables.effectiveFrom,
  effectiveTo: timetables.effectiveTo,
  workingDays: timetables.workingDays,
  dayStartTime: timetables.dayStartTime,
  defaultPeriodDurationMins: timetables.defaultPeriodDurationMins,
  createdAt: timetables.createdAt,
  updatedAt: timetables.updatedAt,
} as const;

const sectionLiveColumns = {
  id: timetableSectionsLive.id,
  tenantId: timetableSectionsLive.tenantId,
  timetableId: timetableSectionsLive.timetableId,
  sectionId: timetableSectionsLive.sectionId,
  createdAt: timetableSectionsLive.createdAt,
  updatedAt: timetableSectionsLive.updatedAt,
} as const;

const sectionWriteReturning = {
  id: timetableSections.id,
  tenantId: timetableSections.tenantId,
  timetableId: timetableSections.timetableId,
  sectionId: timetableSections.sectionId,
  createdAt: timetableSections.createdAt,
  updatedAt: timetableSections.updatedAt,
} as const;

const periodLiveColumns = {
  id: timetablePeriodsLive.id,
  tenantId: timetablePeriodsLive.tenantId,
  timetableId: timetablePeriodsLive.timetableId,
  kind: timetablePeriodsLive.kind,
  label: timetablePeriodsLive.label,
  sequence: timetablePeriodsLive.sequence,
  startTime: timetablePeriodsLive.startTime,
  endTime: timetablePeriodsLive.endTime,
  session: timetablePeriodsLive.session,
  createdAt: timetablePeriodsLive.createdAt,
  updatedAt: timetablePeriodsLive.updatedAt,
} as const;

const periodWriteReturning = {
  id: timetablePeriods.id,
  tenantId: timetablePeriods.tenantId,
  timetableId: timetablePeriods.timetableId,
  kind: timetablePeriods.kind,
  label: timetablePeriods.label,
  sequence: timetablePeriods.sequence,
  startTime: timetablePeriods.startTime,
  endTime: timetablePeriods.endTime,
  session: timetablePeriods.session,
  createdAt: timetablePeriods.createdAt,
  updatedAt: timetablePeriods.updatedAt,
} as const;

const entryLiveColumns = {
  id: timetableEntriesLive.id,
  tenantId: timetableEntriesLive.tenantId,
  timetableId: timetableEntriesLive.timetableId,
  periodId: timetableEntriesLive.periodId,
  sectionId: timetableEntriesLive.sectionId,
  dayOfWeek: timetableEntriesLive.dayOfWeek,
  splitIndex: timetableEntriesLive.splitIndex,
  splitLabel: timetableEntriesLive.splitLabel,
  subjectId: timetableEntriesLive.subjectId,
  teacherId: timetableEntriesLive.teacherId,
  room: timetableEntriesLive.room,
  notes: timetableEntriesLive.notes,
  createdAt: timetableEntriesLive.createdAt,
  updatedAt: timetableEntriesLive.updatedAt,
} as const;

const entryWriteReturning = {
  id: timetableEntries.id,
  tenantId: timetableEntries.tenantId,
  timetableId: timetableEntries.timetableId,
  periodId: timetableEntries.periodId,
  sectionId: timetableEntries.sectionId,
  dayOfWeek: timetableEntries.dayOfWeek,
  splitIndex: timetableEntries.splitIndex,
  splitLabel: timetableEntries.splitLabel,
  subjectId: timetableEntries.subjectId,
  teacherId: timetableEntries.teacherId,
  room: timetableEntries.room,
  notes: timetableEntries.notes,
  createdAt: timetableEntries.createdAt,
  updatedAt: timetableEntries.updatedAt,
} as const;

const overrideLiveColumns = {
  id: timetableDayOverridesLive.id,
  tenantId: timetableDayOverridesLive.tenantId,
  timetableId: timetableDayOverridesLive.timetableId,
  date: timetableDayOverridesLive.date,
  sectionId: timetableDayOverridesLive.sectionId,
  periodId: timetableDayOverridesLive.periodId,
  splitIndex: timetableDayOverridesLive.splitIndex,
  overrideType: timetableDayOverridesLive.overrideType,
  subjectId: timetableDayOverridesLive.subjectId,
  teacherId: timetableDayOverridesLive.teacherId,
  room: timetableDayOverridesLive.room,
  originalSubjectId: timetableDayOverridesLive.originalSubjectId,
  originalTeacherId: timetableDayOverridesLive.originalTeacherId,
  reason: timetableDayOverridesLive.reason,
  createdAt: timetableDayOverridesLive.createdAt,
  updatedAt: timetableDayOverridesLive.updatedAt,
} as const;

const overrideWriteReturning = {
  id: timetableDayOverrides.id,
  tenantId: timetableDayOverrides.tenantId,
  timetableId: timetableDayOverrides.timetableId,
  date: timetableDayOverrides.date,
  sectionId: timetableDayOverrides.sectionId,
  periodId: timetableDayOverrides.periodId,
  splitIndex: timetableDayOverrides.splitIndex,
  overrideType: timetableDayOverrides.overrideType,
  subjectId: timetableDayOverrides.subjectId,
  teacherId: timetableDayOverrides.teacherId,
  room: timetableDayOverrides.room,
  originalSubjectId: timetableDayOverrides.originalSubjectId,
  originalTeacherId: timetableDayOverrides.originalTeacherId,
  reason: timetableDayOverrides.reason,
  createdAt: timetableDayOverrides.createdAt,
  updatedAt: timetableDayOverrides.updatedAt,
} as const;

@Injectable()
export class TimetableDrizzleRepository extends TimetableRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  private ctx() {
    return mkInstituteCtx(this.getTenantId(), 'repository:timetable');
  }

  // ── Master ──────────────────────────────────────────────────────────────

  async createTimetable(data: CreateTimetableData): Promise<TimetableRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(timetables)
        .values({
          tenantId,
          academicYearId: data.academicYearId,
          name: data.name,
          description: data.description ?? null,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo,
          workingDays: data.workingDays,
          dayStartTime: data.dayStartTime,
          defaultPeriodDurationMins: data.defaultPeriodDurationMins,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(timetableWriteReturning);
      return rows[0] as TimetableRecord;
    });
  }

  async createWithGrid(
    data: CreateTimetableData,
    sectionIds: string[],
    periods: Omit<CreatePeriodData, 'timetableId'>[],
  ): Promise<TimetableRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const inserted = await tx
        .insert(timetables)
        .values({
          tenantId,
          academicYearId: data.academicYearId,
          name: data.name,
          description: data.description ?? null,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo,
          workingDays: data.workingDays,
          dayStartTime: data.dayStartTime,
          defaultPeriodDurationMins: data.defaultPeriodDurationMins,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(timetableWriteReturning);
      const timetable = inserted[0] as TimetableRecord;

      if (sectionIds.length > 0) {
        await tx.insert(timetableSections).values(
          sectionIds.map((sectionId) => ({
            tenantId,
            timetableId: timetable.id,
            sectionId,
            createdBy: userId,
            updatedBy: userId,
          })),
        );
      }
      if (periods.length > 0) {
        await tx.insert(timetablePeriods).values(
          periods.map((p) => ({
            tenantId,
            timetableId: timetable.id,
            kind: p.kind,
            label: p.label,
            sequence: p.sequence,
            startTime: p.startTime,
            endTime: p.endTime,
            session: p.session,
            createdBy: userId,
            updatedBy: userId,
          })),
        );
      }
      return timetable;
    });
  }

  async findTimetableById(id: string): Promise<TimetableRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(timetableLiveColumns)
        .from(timetablesLive)
        .where(eq(timetablesLive.id, id));
      return (rows[0] as TimetableRecord | undefined) ?? null;
    });
  }

  async listTimetables(query: ListTimetablesQuery): Promise<PaginatedTimetables> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const conditions = [];
      if (query.academicYearId)
        conditions.push(eq(timetablesLive.academicYearId, query.academicYearId));
      if (query.status) conditions.push(eq(timetablesLive.status, query.status));
      if (query.search) {
        conditions.push(sql`${timetablesLive.name}::text ILIKE ${`%${query.search}%`}`);
      }
      if (query.sectionId) {
        const covered = tx
          .select({ id: timetableSectionsLive.timetableId })
          .from(timetableSectionsLive)
          .where(eq(timetableSectionsLive.sectionId, query.sectionId));
        conditions.push(sql`${timetablesLive.id} IN ${covered}`);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const totalRows = await tx.select({ value: count() }).from(timetablesLive).where(where);
      const total = Number(totalRows[0]?.value ?? 0);

      const docs = (await tx
        .select(timetableLiveColumns)
        .from(timetablesLive)
        .where(where)
        .orderBy(desc(timetablesLive.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage)) as TimetableRecord[];

      return {
        docs,
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      };
    });
  }

  async updateTimetable(id: string, data: UpdateTimetableData): Promise<TimetableRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(timetables)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.effectiveFrom !== undefined && { effectiveFrom: data.effectiveFrom }),
          ...(data.effectiveTo !== undefined && { effectiveTo: data.effectiveTo }),
          ...(data.workingDays !== undefined && { workingDays: data.workingDays }),
          updatedBy: userId,
        })
        .where(and(eq(timetables.id, id), isNull(timetables.deletedAt)))
        .returning(timetableWriteReturning);
      if (rows.length === 0) throw new NotFoundException(`Timetable ${id} not found`);
      return rows[0] as TimetableRecord;
    });
  }

  async setStatus(id: string, status: TimetableRecord['status']): Promise<TimetableRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(timetables)
        .set({ status, updatedBy: userId })
        .where(and(eq(timetables.id, id), isNull(timetables.deletedAt)))
        .returning(timetableWriteReturning);
      if (rows.length === 0) throw new NotFoundException(`Timetable ${id} not found`);
      return rows[0] as TimetableRecord;
    });
  }

  async activateExclusive(
    id: string,
    academicYearId: string,
  ): Promise<{ timetable: TimetableRecord; previousActiveId: string | null }> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      // Demote the current ACTIVE (other than target) so the partial-unique
      // index never sees two ACTIVE rows for the same (tenant, year).
      const demoted = await tx
        .update(timetables)
        .set({ status: 'INACTIVE', updatedBy: userId })
        .where(
          and(
            eq(timetables.academicYearId, academicYearId),
            eq(timetables.status, 'ACTIVE'),
            ne(timetables.id, id),
            isNull(timetables.deletedAt),
          ),
        )
        .returning({ id: timetables.id });

      const rows = await tx
        .update(timetables)
        .set({ status: 'ACTIVE', updatedBy: userId })
        .where(and(eq(timetables.id, id), isNull(timetables.deletedAt)))
        .returning(timetableWriteReturning);
      if (rows.length === 0) throw new NotFoundException(`Timetable ${id} not found`);

      return {
        timetable: rows[0] as TimetableRecord,
        previousActiveId: demoted[0]?.id ?? null,
      };
    });
  }

  async findActiveTimetable(academicYearId: string): Promise<TimetableRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(timetableLiveColumns)
        .from(timetablesLive)
        .where(
          and(
            eq(timetablesLive.academicYearId, academicYearId),
            eq(timetablesLive.status, 'ACTIVE'),
          ),
        );
      return (rows[0] as TimetableRecord | undefined) ?? null;
    });
  }

  async statistics(academicYearId?: string): Promise<TimetableStatisticsRow> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const where = academicYearId ? eq(timetablesLive.academicYearId, academicYearId) : undefined;
      const rows = await tx
        .select({ status: timetablesLive.status, value: count() })
        .from(timetablesLive)
        .where(where)
        .groupBy(timetablesLive.status);
      const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.value)]));
      const draft = by.DRAFT ?? 0;
      const active = by.ACTIVE ?? 0;
      const inactive = by.INACTIVE ?? 0;
      const archived = by.ARCHIVED ?? 0;
      return { total: draft + active + inactive + archived, draft, active, inactive, archived };
    });
  }

  async softDeleteTimetable(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, timetables, id);
    });
  }

  async restoreTimetable(id: string): Promise<TimetableRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(timetables)
        .set({ deletedAt: null, deletedBy: null, updatedBy: userId })
        .where(eq(timetables.id, id))
        .returning(timetableWriteReturning);
      if (rows.length === 0) throw new NotFoundException(`Timetable ${id} not found`);
      return rows[0] as TimetableRecord;
    });
  }

  // ── Covered sections ──────────────────────────────────────────────────────

  async addSection(timetableId: string, sectionId: string): Promise<TimetableSectionRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(timetableSections)
        .values({ tenantId, timetableId, sectionId, createdBy: userId, updatedBy: userId })
        .returning(sectionWriteReturning);
      return rows[0] as TimetableSectionRecord;
    });
  }

  async removeSection(timetableId: string, sectionId: string): Promise<void> {
    const { userId } = getRequestContext();
    await withTenant(this.db, this.ctx(), async (tx) => {
      await tx
        .update(timetableSections)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(
          and(
            eq(timetableSections.timetableId, timetableId),
            eq(timetableSections.sectionId, sectionId),
            isNull(timetableSections.deletedAt),
          ),
        );
    });
  }

  async findSections(timetableId: string): Promise<TimetableSectionRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(sectionLiveColumns)
        .from(timetableSectionsLive)
        .where(eq(timetableSectionsLive.timetableId, timetableId)) as Promise<
        TimetableSectionRecord[]
      >;
    });
  }

  // ── Periods ─────────────────────────────────────────────────────────────

  async createPeriods(data: CreatePeriodData[]): Promise<TimetablePeriodRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .insert(timetablePeriods)
        .values(
          data.map((p) => ({
            tenantId,
            timetableId: p.timetableId,
            kind: p.kind,
            label: p.label,
            sequence: p.sequence,
            startTime: p.startTime,
            endTime: p.endTime,
            session: p.session,
            createdBy: userId,
            updatedBy: userId,
          })),
        )
        .returning(periodWriteReturning) as Promise<TimetablePeriodRecord[]>;
    });
  }

  async findPeriods(timetableId: string): Promise<TimetablePeriodRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(periodLiveColumns)
        .from(timetablePeriodsLive)
        .where(eq(timetablePeriodsLive.timetableId, timetableId))
        .orderBy(asc(timetablePeriodsLive.sequence)) as Promise<TimetablePeriodRecord[]>;
    });
  }

  async findPeriodById(id: string): Promise<TimetablePeriodRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(periodLiveColumns)
        .from(timetablePeriodsLive)
        .where(eq(timetablePeriodsLive.id, id));
      return (rows[0] as TimetablePeriodRecord | undefined) ?? null;
    });
  }

  async updatePeriod(id: string, data: UpdatePeriodData): Promise<TimetablePeriodRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(timetablePeriods)
        .set({
          ...(data.label !== undefined && { label: data.label }),
          ...(data.startTime !== undefined && { startTime: data.startTime }),
          ...(data.endTime !== undefined && { endTime: data.endTime }),
          updatedBy: userId,
        })
        .where(and(eq(timetablePeriods.id, id), isNull(timetablePeriods.deletedAt)))
        .returning(periodWriteReturning);
      if (rows.length === 0) throw new NotFoundException(`Timetable period ${id} not found`);
      return rows[0] as TimetablePeriodRecord;
    });
  }

  async softDeletePeriod(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, timetablePeriods, id);
    });
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  async createEntries(data: UpsertEntryData[]): Promise<TimetableEntryRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .insert(timetableEntries)
        .values(
          data.map((e) => ({
            tenantId,
            timetableId: e.timetableId,
            periodId: e.periodId,
            sectionId: e.sectionId,
            dayOfWeek: e.dayOfWeek,
            splitIndex: e.splitIndex,
            splitLabel: e.splitLabel ?? null,
            subjectId: e.subjectId ?? null,
            teacherId: e.teacherId ?? null,
            room: e.room ?? null,
            notes: e.notes ?? null,
            createdBy: userId,
            updatedBy: userId,
          })),
        )
        .returning(entryWriteReturning) as Promise<TimetableEntryRecord[]>;
    });
  }

  async upsertEntry(data: UpsertEntryData): Promise<TimetableEntryRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const existing = await tx
        .select({ id: timetableEntriesLive.id })
        .from(timetableEntriesLive)
        .where(
          and(
            eq(timetableEntriesLive.timetableId, data.timetableId),
            eq(timetableEntriesLive.sectionId, data.sectionId),
            eq(timetableEntriesLive.periodId, data.periodId),
            eq(timetableEntriesLive.dayOfWeek, data.dayOfWeek),
            eq(timetableEntriesLive.splitIndex, data.splitIndex),
          ),
        );

      const existingId = existing[0]?.id;
      if (existingId) {
        const rows = await tx
          .update(timetableEntries)
          .set({
            splitLabel: data.splitLabel ?? null,
            subjectId: data.subjectId ?? null,
            teacherId: data.teacherId ?? null,
            room: data.room ?? null,
            notes: data.notes ?? null,
            updatedBy: userId,
          })
          .where(and(eq(timetableEntries.id, existingId), isNull(timetableEntries.deletedAt)))
          .returning(entryWriteReturning);
        return rows[0] as TimetableEntryRecord;
      }

      const rows = await tx
        .insert(timetableEntries)
        .values({
          tenantId,
          timetableId: data.timetableId,
          periodId: data.periodId,
          sectionId: data.sectionId,
          dayOfWeek: data.dayOfWeek,
          splitIndex: data.splitIndex,
          splitLabel: data.splitLabel ?? null,
          subjectId: data.subjectId ?? null,
          teacherId: data.teacherId ?? null,
          room: data.room ?? null,
          notes: data.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(entryWriteReturning);
      return rows[0] as TimetableEntryRecord;
    });
  }

  async clearEntry(query: ClearEntryQuery): Promise<void> {
    const { userId } = getRequestContext();
    await withTenant(this.db, this.ctx(), async (tx) => {
      await tx
        .update(timetableEntries)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(
          and(
            eq(timetableEntries.timetableId, query.timetableId),
            eq(timetableEntries.sectionId, query.sectionId),
            eq(timetableEntries.periodId, query.periodId),
            eq(timetableEntries.dayOfWeek, query.dayOfWeek),
            eq(timetableEntries.splitIndex, query.splitIndex),
            isNull(timetableEntries.deletedAt),
          ),
        );
    });
  }

  async findEntriesByTimetable(timetableId: string): Promise<TimetableEntryRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(entryLiveColumns)
        .from(timetableEntriesLive)
        .where(eq(timetableEntriesLive.timetableId, timetableId)) as Promise<
        TimetableEntryRecord[]
      >;
    });
  }

  async findEntriesBySection(
    timetableId: string,
    sectionId: string,
  ): Promise<TimetableEntryRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(entryLiveColumns)
        .from(timetableEntriesLive)
        .where(
          and(
            eq(timetableEntriesLive.timetableId, timetableId),
            eq(timetableEntriesLive.sectionId, sectionId),
          ),
        ) as Promise<TimetableEntryRecord[]>;
    });
  }

  async findEntriesByTeacher(
    timetableId: string,
    teacherId: string,
  ): Promise<TimetableEntryRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(entryLiveColumns)
        .from(timetableEntriesLive)
        .where(
          and(
            eq(timetableEntriesLive.timetableId, timetableId),
            eq(timetableEntriesLive.teacherId, teacherId),
          ),
        ) as Promise<TimetableEntryRecord[]>;
    });
  }

  async findEntriesAtSlot(
    timetableId: string,
    periodId: string,
    dayOfWeek: Weekday,
  ): Promise<TimetableEntryRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(entryLiveColumns)
        .from(timetableEntriesLive)
        .where(
          and(
            eq(timetableEntriesLive.timetableId, timetableId),
            eq(timetableEntriesLive.periodId, periodId),
            eq(timetableEntriesLive.dayOfWeek, dayOfWeek),
          ),
        ) as Promise<TimetableEntryRecord[]>;
    });
  }

  // ── Day overrides ───────────────────────────────────────────────────────────

  async createOverride(data: CreateOverrideData): Promise<TimetableDayOverrideRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(timetableDayOverrides)
        .values({
          tenantId,
          timetableId: data.timetableId,
          date: data.date,
          sectionId: data.sectionId,
          periodId: data.periodId,
          splitIndex: data.splitIndex,
          overrideType: data.overrideType,
          subjectId: data.subjectId ?? null,
          teacherId: data.teacherId ?? null,
          room: data.room ?? null,
          originalSubjectId: data.originalSubjectId ?? null,
          originalTeacherId: data.originalTeacherId ?? null,
          reason: data.reason ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(overrideWriteReturning);
      return rows[0] as TimetableDayOverrideRecord;
    });
  }

  async findOverrideById(id: string): Promise<TimetableDayOverrideRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(overrideLiveColumns)
        .from(timetableDayOverridesLive)
        .where(eq(timetableDayOverridesLive.id, id));
      return (rows[0] as TimetableDayOverrideRecord | undefined) ?? null;
    });
  }

  async findOverridesByDate(
    timetableId: string,
    date: string,
  ): Promise<TimetableDayOverrideRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(overrideLiveColumns)
        .from(timetableDayOverridesLive)
        .where(
          and(
            eq(timetableDayOverridesLive.timetableId, timetableId),
            sql`${timetableDayOverridesLive.date} = ${date}::date`,
          ),
        ) as Promise<TimetableDayOverrideRecord[]>;
    });
  }

  async findOverridesBySectionRange(
    sectionId: string,
    startDate: string,
    endDate: string,
  ): Promise<TimetableDayOverrideRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(overrideLiveColumns)
        .from(timetableDayOverridesLive)
        .where(
          and(
            eq(timetableDayOverridesLive.sectionId, sectionId),
            between(timetableDayOverridesLive.date, startDate, endDate),
          ),
        ) as Promise<TimetableDayOverrideRecord[]>;
    });
  }

  async softDeleteOverride(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, timetableDayOverrides, id);
    });
  }
}
