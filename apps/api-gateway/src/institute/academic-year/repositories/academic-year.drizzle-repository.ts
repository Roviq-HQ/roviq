import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, type InstituteType } from '@roviq/common-types';
import {
  type AcademicYearStatus,
  academicYears,
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteConfigsLive,
  institutesLive,
  mkAdminCtx,
  mkInstituteCtx,
  sectionsLive,
  softDelete,
  standardsLive,
  type TermConfig,
  withAdmin,
  withTenant,
  yearRolloverSectionMap,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { rollOverStudents } from '../../student/year-rollover';
import { AcademicYearRepository } from './academic-year.repository';
import type {
  AcademicYearRecord,
  CreateAcademicYearData,
  RolloverPreviewRecord,
  RolloverSectionMapEntry,
  SetRolloverSectionMapResult,
  UpdateAcademicYearData,
} from './types';

// Read projection — `academic_years_live` view excludes soft-deleted rows.
const liveColumns = {
  id: academicYearsLive.id,
  tenantId: academicYearsLive.tenantId,
  label: academicYearsLive.label,
  startDate: academicYearsLive.startDate,
  endDate: academicYearsLive.endDate,
  isActive: academicYearsLive.isActive,
  status: academicYearsLive.status,
  termStructure: academicYearsLive.termStructure,
  boardExamDates: academicYearsLive.boardExamDates,
  createdAt: academicYearsLive.createdAt,
  updatedAt: academicYearsLive.updatedAt,
} as const;

// Same projection on the base table — used by INSERT/UPDATE … RETURNING.
const writeReturning = {
  id: academicYears.id,
  tenantId: academicYears.tenantId,
  label: academicYears.label,
  startDate: academicYears.startDate,
  endDate: academicYears.endDate,
  isActive: academicYears.isActive,
  status: academicYears.status,
  termStructure: academicYears.termStructure,
  boardExamDates: academicYears.boardExamDates,
  createdAt: academicYears.createdAt,
  updatedAt: academicYears.updatedAt,
} as const;

@Injectable()
export class AcademicYearDrizzleRepository extends AcademicYearRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findById(id: string): Promise<AcademicYearRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const rows = await tx
        .select(liveColumns)
        .from(academicYearsLive)
        .where(eq(academicYearsLive.id, id));
      return (rows[0] as AcademicYearRecord | undefined) ?? null;
    });
  }

  async findAll(): Promise<AcademicYearRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      return tx
        .select(liveColumns)
        .from(academicYearsLive)
        .orderBy(asc(academicYearsLive.startDate)) as Promise<AcademicYearRecord[]>;
    });
  }

  async findActive(): Promise<AcademicYearRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const rows = await tx
        .select(liveColumns)
        .from(academicYearsLive)
        .where(eq(academicYearsLive.isActive, true));
      return (rows[0] as AcademicYearRecord | undefined) ?? null;
    });
  }

  async previewRollover(targetYearId: string): Promise<RolloverPreviewRecord> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const [active] = await tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.isActive, true));
      if (!active) {
        return {
          counts: {
            movingUp: 0,
            staying: 0,
            completing: 0,
            notCarried: 0,
            noClassInNewYear: 0,
            alreadyPlaced: 0,
          },
          sections: [],
          moves: [],
          hardMax: null,
        };
      }
      const { counts, moves } = await rollOverStudents(tx, {
        tenantId,
        previousYearId: active.id,
        academicYearId: targetYearId,
        write: false,
      });

      const sectionColumns = {
        sectionId: sectionsLive.id,
        standardId: sectionsLive.standardId,
        standardName: standardsLive.name,
        sectionName: sectionsLive.name,
        currentStrength: sectionsLive.currentStrength,
      };
      const classOrder = [
        asc(standardsLive.numericOrder),
        asc(sectionsLive.displayOrder),
        asc(sectionsLive.id),
      ];
      const targetSections = await tx
        .select(sectionColumns)
        .from(sectionsLive)
        .innerJoin(standardsLive, eq(standardsLive.id, sectionsLive.standardId))
        .where(eq(sectionsLive.academicYearId, targetYearId))
        .orderBy(...classOrder);
      const fromIds = [...new Set(moves.map((m) => m.fromSectionId))];
      const fromSections =
        fromIds.length === 0
          ? []
          : await tx
              .select(sectionColumns)
              .from(sectionsLive)
              .innerJoin(standardsLive, eq(standardsLive.id, sectionsLive.standardId))
              .where(inArray(sectionsLive.id, fromIds))
              .orderBy(...classOrder);
      const [config] = await tx
        .select({ norms: instituteConfigsLive.sectionStrengthNorms })
        .from(instituteConfigsLive)
        .limit(1);

      const incoming = new Map<string, number>();
      for (const move of moves) {
        if (move.toSectionId) {
          incoming.set(move.toSectionId, (incoming.get(move.toSectionId) ?? 0) + move.students);
        }
      }
      return {
        counts,
        sections: targetSections.map((s) => ({ ...s, incoming: incoming.get(s.sectionId) ?? 0 })),
        // Source sections in class order; the largest group of a section first.
        moves: fromSections.flatMap((from) =>
          moves
            .filter((m) => m.fromSectionId === from.sectionId)
            .sort((a, b) => b.students - a.students)
            .map((m) => ({
              ...m,
              fromStandardName: from.standardName,
              fromSectionName: from.sectionName,
            })),
        ),
        hardMax: config?.norms?.hardMax ?? null,
      };
    });
  }

  async setRolloverSectionMap(
    targetYearId: string,
    entries: RolloverSectionMapEntry[],
  ): Promise<SetRolloverSectionMapResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      // Every id is read through RLS first: a foreign key would accept another institute's row.
      const years = await tx
        .select({ id: academicYearsLive.id, isActive: academicYearsLive.isActive })
        .from(academicYearsLive)
        .where(or(eq(academicYearsLive.id, targetYearId), eq(academicYearsLive.isActive, true)));
      const target = years.find((y) => y.id === targetYearId);
      if (!target) return { kind: 'year_not_found' };
      if (target.isActive) return { kind: 'year_is_active' };
      const active = years.find((y) => y.isActive);
      if (!active) return { kind: 'no_active_year' };

      const toSet = entries.filter(
        (e): e is { fromSectionId: string; toSectionId: string } => e.toSectionId !== null,
      );
      const sectionIds = [
        ...new Set([...entries.map((e) => e.fromSectionId), ...toSet.map((e) => e.toSectionId)]),
      ];
      if (sectionIds.length === 0) return { kind: 'ok' };
      const found = await tx
        .select({ id: sectionsLive.id, academicYearId: sectionsLive.academicYearId })
        .from(sectionsLive)
        .where(inArray(sectionsLive.id, sectionIds));
      const yearOf = new Map(found.map((s) => [s.id, s.academicYearId]));
      for (const entry of entries) {
        if (yearOf.get(entry.fromSectionId) !== active.id) {
          return { kind: 'section_not_found', sectionId: entry.fromSectionId };
        }
        if (entry.toSectionId !== null && yearOf.get(entry.toSectionId) !== targetYearId) {
          return { kind: 'section_not_found', sectionId: entry.toSectionId };
        }
      }

      const now = new Date();
      const toClear = entries.filter((e) => e.toSectionId === null).map((e) => e.fromSectionId);
      if (toClear.length > 0) {
        await tx
          .update(yearRolloverSectionMap)
          .set({
            deletedAt: now,
            deletedBy: userId,
            updatedAt: now,
            updatedBy: userId,
            version: sql`${yearRolloverSectionMap.version} + 1`,
          })
          .where(
            and(
              eq(yearRolloverSectionMap.academicYearId, targetYearId),
              inArray(yearRolloverSectionMap.fromSectionId, toClear),
              isNull(yearRolloverSectionMap.deletedAt),
            ),
          );
      }
      if (toSet.length > 0) {
        await tx
          .insert(yearRolloverSectionMap)
          .values(
            toSet.map((e) => ({
              tenantId,
              academicYearId: targetYearId,
              fromSectionId: e.fromSectionId,
              toSectionId: e.toSectionId,
              createdBy: userId,
              updatedBy: userId,
            })),
          )
          .onConflictDoUpdate({
            target: [yearRolloverSectionMap.academicYearId, yearRolloverSectionMap.fromSectionId],
            targetWhere: sql`${yearRolloverSectionMap.deletedAt} IS NULL`,
            set: {
              toSectionId: sql`excluded.to_section_id`,
              updatedAt: now,
              updatedBy: userId,
              version: sql`${yearRolloverSectionMap.version} + 1`,
            },
          });
      }
      return { kind: 'ok' };
    });
  }

  async findOverlapping(
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): Promise<AcademicYearRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const conditions = [
        // Date ranges overlap: existing.start < new.end AND existing.end > new.start
        sql`${academicYearsLive.startDate} < ${endDate}`,
        sql`${academicYearsLive.endDate} > ${startDate}`,
      ];
      if (excludeId) {
        conditions.push(ne(academicYearsLive.id, excludeId));
      }
      return tx
        .select(liveColumns)
        .from(academicYearsLive)
        .where(and(...conditions)) as Promise<AcademicYearRecord[]>;
    });
  }

  async create(data: CreateAcademicYearData): Promise<AcademicYearRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const rows = await tx
        .insert(academicYears)
        .values({
          tenantId,
          label: data.label,
          startDate: data.startDate,
          endDate: data.endDate,
          termStructure: (data.termStructure ?? []) as TermConfig[],
          status: 'PLANNING',
          isActive: false,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(writeReturning);
      return rows[0] as AcademicYearRecord;
    });
  }

  async update(id: string, data: UpdateAcademicYearData): Promise<AcademicYearRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const rows = await tx
        .update(academicYears)
        .set({
          ...(data.label !== undefined && { label: data.label }),
          ...(data.startDate !== undefined && { startDate: data.startDate }),
          ...(data.endDate !== undefined && { endDate: data.endDate }),
          ...(data.termStructure !== undefined && {
            termStructure: data.termStructure as TermConfig[],
          }),
          ...(data.boardExamDates !== undefined && { boardExamDates: data.boardExamDates }),
          updatedBy: userId,
        })
        .where(and(eq(academicYears.id, id), isNull(academicYears.deletedAt)))
        .returning(writeReturning);

      if (rows.length === 0)
        throw new BusinessException(
          ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
          `Academic year ${id} not found`,
        );
      return rows[0] as AcademicYearRecord;
    });
  }

  async activate(id: string, previousActiveId: string | null): Promise<AcademicYearRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      // Deactivate previous active year
      if (previousActiveId) {
        await tx
          .update(academicYears)
          .set({ isActive: false, status: 'COMPLETING', updatedBy: userId })
          .where(eq(academicYears.id, previousActiveId));
      }

      // Activate target year
      const rows = await tx
        .update(academicYears)
        .set({ isActive: true, status: 'ACTIVE', updatedBy: userId })
        .where(eq(academicYears.id, id))
        .returning(writeReturning);

      if (rows.length === 0)
        throw new BusinessException(
          ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
          `Academic year ${id} not found`,
        );
      return rows[0] as AcademicYearRecord;
    });
  }

  async updateStatus(id: string, status: AcademicYearStatus): Promise<AcademicYearRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      const rows = await tx
        .update(academicYears)
        .set({ status, updatedBy: userId })
        .where(eq(academicYears.id, id))
        .returning(writeReturning);

      if (rows.length === 0)
        throw new BusinessException(
          ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
          `Academic year ${id} not found`,
        );
      return rows[0] as AcademicYearRecord;
    });
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:academic-year'), async (tx) => {
      await softDelete(tx, academicYears, id);
    });
  }

  // `institutes` has no institute-role policy on its own id, hence the admin role; keyed by the token tenant.
  async findInstituteType(tenantId: string): Promise<InstituteType | null> {
    const rows = await withAdmin(this.db, mkAdminCtx('service:academic-year'), async (tx) => {
      return tx
        .select({ type: institutesLive.type })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1);
    });
    if (rows.length === 0) return null;
    return rows[0].type as InstituteType;
  }
}
