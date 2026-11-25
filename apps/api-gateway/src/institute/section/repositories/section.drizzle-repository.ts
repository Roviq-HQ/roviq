import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  i18nNameSearch,
  mapUniqueViolation,
  membershipsLive,
  mkInstituteCtx,
  sections,
  sectionsLive,
  softDelete,
  standardsLive,
  studentAcademicsLive,
  type UniqueViolationErrors,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { SectionRepository } from './section.repository';
import type {
  CreateSectionData,
  SectionRecord,
  SectionWriteResult,
  UpdateSectionData,
} from './types';

// Read projection — pulls from `sections_live` (security_invoker view that
// hides soft-deleted rows). Repositories that need trashed rows query the
// underlying `sections` table directly.
const liveColumns = {
  id: sectionsLive.id,
  tenantId: sectionsLive.tenantId,
  standardId: sectionsLive.standardId,
  academicYearId: sectionsLive.academicYearId,
  name: sectionsLive.name,
  displayLabel: sectionsLive.displayLabel,
  stream: sectionsLive.stream,
  mediumOfInstruction: sectionsLive.mediumOfInstruction,
  shift: sectionsLive.shift,
  classTeacherId: sectionsLive.classTeacherId,
  room: sectionsLive.room,
  capacity: sectionsLive.capacity,
  currentStrength: sectionsLive.currentStrength,
  genderRestriction: sectionsLive.genderRestriction,
  displayOrder: sectionsLive.displayOrder,
  startTime: sectionsLive.startTime,
  endTime: sectionsLive.endTime,
  batchStatus: sectionsLive.batchStatus,
  createdAt: sectionsLive.createdAt,
  updatedAt: sectionsLive.updatedAt,
} as const;

// Same projection on the base table — used by INSERT … RETURNING and
// UPDATE … RETURNING which can't return through a view.
const writeReturning = {
  id: sections.id,
  tenantId: sections.tenantId,
  standardId: sections.standardId,
  academicYearId: sections.academicYearId,
  name: sections.name,
  displayLabel: sections.displayLabel,
  stream: sections.stream,
  mediumOfInstruction: sections.mediumOfInstruction,
  shift: sections.shift,
  classTeacherId: sections.classTeacherId,
  room: sections.room,
  capacity: sections.capacity,
  currentStrength: sections.currentStrength,
  genderRestriction: sections.genderRestriction,
  displayOrder: sections.displayOrder,
  startTime: sections.startTime,
  endTime: sections.endTime,
  batchStatus: sections.batchStatus,
  createdAt: sections.createdAt,
  updatedAt: sections.updatedAt,
} as const;

type GenderEnum = (typeof sections.genderRestriction.enumValues)[number];
type BatchEnum = (typeof sections.batchStatus.enumValues)[number];

const SECTION_TAKEN: UniqueViolationErrors = {
  sections_standard_name_key: () =>
    new BusinessException(
      ErrorCode.SECTION_NAME_DUPLICATE,
      'A section with this name already exists in this standard',
    ),
};

@Injectable()
export class SectionDrizzleRepository extends SectionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async searchByName(query: string): Promise<SectionRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:section'), async (tx) =>
      tx
        .select(liveColumns)
        .from(sectionsLive)
        .where(i18nNameSearch(sectionsLive.name, query))
        .orderBy(asc(sectionsLive.id))
        .limit(20),
    );
  }

  async findById(id: string): Promise<SectionRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:section'), async (tx) => {
      const rows = await tx.select(liveColumns).from(sectionsLive).where(eq(sectionsLive.id, id));
      return (rows[0] as SectionRecord | undefined) ?? null;
    });
  }

  async findByStandard(standardId: string): Promise<SectionRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:section'), async (tx) => {
      return tx
        .select(liveColumns)
        .from(sectionsLive)
        .where(eq(sectionsLive.standardId, standardId))
        .orderBy(asc(sectionsLive.displayOrder)) as Promise<SectionRecord[]>;
    });
  }

  async findByAcademicYear(academicYearId: string): Promise<SectionRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:section'), async (tx) => {
      return (
        tx
          .select(liveColumns)
          .from(sectionsLive)
          .where(eq(sectionsLive.academicYearId, academicYearId))
          // id as stable secondary so paging/grids render deterministically.
          .orderBy(asc(sectionsLive.displayOrder), asc(sectionsLive.id)) as Promise<SectionRecord[]>
      );
    });
  }

  async create(data: CreateSectionData): Promise<SectionWriteResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant<SectionWriteResult>(
      this.db,
      mkInstituteCtx(tenantId, 'repository:section'),
      async (tx) => {
        // Foreign keys accept any institute's row; the views under RLS do not.
        const [year] = await tx
          .select({ id: academicYearsLive.id })
          .from(academicYearsLive)
          .where(eq(academicYearsLive.id, data.academicYearId))
          .limit(1);
        if (!year) return { kind: 'year_not_found' };
        const [standard] = await tx
          .select({ id: standardsLive.id })
          .from(standardsLive)
          .where(
            and(
              eq(standardsLive.id, data.standardId),
              eq(standardsLive.academicYearId, data.academicYearId),
            ),
          )
          .limit(1);
        if (!standard) return { kind: 'standard_not_found' };
        if (data.classTeacherId && !(await this.membershipExists(tx, data.classTeacherId))) {
          return { kind: 'class_teacher_not_found' };
        }

        const rows = await tx
          .insert(sections)
          .values({
            tenantId,
            standardId: data.standardId,
            academicYearId: data.academicYearId,
            name: data.name,
            displayLabel: data.displayLabel,
            stream: data.stream,
            mediumOfInstruction: data.mediumOfInstruction,
            shift: data.shift,
            classTeacherId: data.classTeacherId,
            room: data.room,
            capacity: data.capacity,
            genderRestriction: (data.genderRestriction as GenderEnum) ?? 'CO_ED',
            displayOrder: data.displayOrder ?? 0,
            startTime: data.startTime,
            endTime: data.endTime,
            batchStatus: data.batchStatus as BatchEnum | undefined,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning(writeReturning);
        return { kind: 'ok', record: rows[0] as SectionRecord };
      },
    ).catch(mapUniqueViolation(SECTION_TAKEN));
  }

  async update(id: string, data: UpdateSectionData): Promise<SectionWriteResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant<SectionWriteResult>(
      this.db,
      mkInstituteCtx(tenantId, 'repository:section'),
      async (tx) => {
        // The section first: a missing section is the answer whatever the teacher id is.
        const [section] = await tx
          .select({ id: sectionsLive.id })
          .from(sectionsLive)
          .where(eq(sectionsLive.id, id))
          .limit(1);
        if (!section) return { kind: 'section_not_found' };
        if (data.classTeacherId && !(await this.membershipExists(tx, data.classTeacherId))) {
          return { kind: 'class_teacher_not_found' };
        }

        const rows = await tx
          .update(sections)
          .set({
            ...(data.name !== undefined && { name: data.name }),
            ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
            ...(data.stream !== undefined && { stream: data.stream }),
            ...(data.mediumOfInstruction !== undefined && {
              mediumOfInstruction: data.mediumOfInstruction,
            }),
            ...(data.shift !== undefined && { shift: data.shift }),
            ...(data.classTeacherId !== undefined && { classTeacherId: data.classTeacherId }),
            ...(data.room !== undefined && { room: data.room }),
            ...(data.capacity !== undefined && { capacity: data.capacity }),
            ...(data.genderRestriction !== undefined && {
              genderRestriction: data.genderRestriction as GenderEnum,
            }),
            ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
            ...(data.startTime !== undefined && { startTime: data.startTime }),
            ...(data.endTime !== undefined && { endTime: data.endTime }),
            ...(data.batchStatus !== undefined && { batchStatus: data.batchStatus as BatchEnum }),
            updatedBy: userId,
          })
          .where(and(eq(sections.id, id), isNull(sections.deletedAt)))
          .returning(writeReturning);

        if (rows.length === 0) return { kind: 'section_not_found' };
        return { kind: 'ok', record: rows[0] as SectionRecord };
      },
    ).catch(mapUniqueViolation(SECTION_TAKEN));
  }

  private async membershipExists(tx: DrizzleDB, membershipId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: membershipsLive.id })
      .from(membershipsLive)
      .where(eq(membershipsLive.id, membershipId))
      .limit(1);
    return row !== undefined;
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:section'), async (tx) => {
      const [enrolled] = await tx
        .select({ id: studentAcademicsLive.id })
        .from(studentAcademicsLive)
        .where(eq(studentAcademicsLive.sectionId, id))
        .limit(1);
      if (enrolled) {
        throw new BusinessException(
          ErrorCode.SECTION_HAS_STUDENTS,
          'Section still has students; move them before deleting it',
        );
      }
      await softDelete(tx, sections, id);
    });
  }
}
