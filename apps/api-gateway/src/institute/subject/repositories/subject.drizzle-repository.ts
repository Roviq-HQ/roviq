import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  sectionSubjects,
  sectionsLive,
  softDelete,
  standardSubjects,
  standardSubjectsLive,
  standardsLive,
  subjects,
  subjectsLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { SubjectRepository } from './subject.repository';
import type {
  CreateSubjectData,
  CreateSubjectResult,
  SubjectLinkFailure,
  SubjectLinkResult,
  SubjectNameOption,
  SubjectRecord,
  UpdateSubjectData,
} from './types';

// Read-side columns are pulled from `subjects_live` (security_invoker view that
// hides soft-deleted rows). Writes target the underlying `subjects` table.
const liveColumns = {
  id: subjectsLive.id,
  tenantId: subjectsLive.tenantId,
  name: subjectsLive.name,
  shortName: subjectsLive.shortName,
  boardCode: subjectsLive.boardCode,
  type: subjectsLive.type,
  isMandatory: subjectsLive.isMandatory,
  hasPractical: subjectsLive.hasPractical,
  theoryMarks: subjectsLive.theoryMarks,
  practicalMarks: subjectsLive.practicalMarks,
  internalMarks: subjectsLive.internalMarks,
  isElective: subjectsLive.isElective,
  electiveGroup: subjectsLive.electiveGroup,
  createdAt: subjectsLive.createdAt,
  updatedAt: subjectsLive.updatedAt,
} as const;

// Same projection on the base table — used by INSERT … RETURNING and
// UPDATE … RETURNING which can't return through a view.
const writeReturning = {
  id: subjects.id,
  tenantId: subjects.tenantId,
  name: subjects.name,
  shortName: subjects.shortName,
  boardCode: subjects.boardCode,
  type: subjects.type,
  isMandatory: subjects.isMandatory,
  hasPractical: subjects.hasPractical,
  theoryMarks: subjects.theoryMarks,
  practicalMarks: subjects.practicalMarks,
  internalMarks: subjects.internalMarks,
  isElective: subjects.isElective,
  electiveGroup: subjects.electiveGroup,
  createdAt: subjects.createdAt,
  updatedAt: subjects.updatedAt,
} as const;

type SubjectTypeEnum = (typeof subjects.type.enumValues)[number];

@Injectable()
export class SubjectDrizzleRepository extends SubjectRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findById(id: string): Promise<SubjectRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const rows = await tx.select(liveColumns).from(subjectsLive).where(eq(subjectsLive.id, id));
      return (rows[0] as SubjectRecord | undefined) ?? null;
    });
  }

  async findAll(): Promise<SubjectRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      return tx.select(liveColumns).from(subjectsLive).orderBy(asc(subjectsLive.name)) as Promise<
        SubjectRecord[]
      >;
    });
  }

  async findByStandard(standardId: string): Promise<SubjectRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const links = await tx
        .select({ subjectId: standardSubjectsLive.subjectId })
        .from(standardSubjectsLive)
        .where(eq(standardSubjectsLive.standardId, standardId));

      if (links.length === 0) return [];

      const subjectIds = links.map((l) => l.subjectId);
      return tx
        .select(liveColumns)
        .from(subjectsLive)
        .where(inArray(subjectsLive.id, subjectIds))
        .orderBy(asc(subjectsLive.name)) as Promise<SubjectRecord[]>;
    });
  }

  async findByAcademicYear(academicYearId: string): Promise<SubjectNameOption[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      // One batched read for label maps: every subject linked to the year's
      // standards, each tagged with its standard for client-side grouping.
      return tx
        .select({
          id: subjectsLive.id,
          name: subjectsLive.name,
          standardId: standardSubjectsLive.standardId,
        })
        .from(standardSubjectsLive)
        .innerJoin(standardsLive, eq(standardsLive.id, standardSubjectsLive.standardId))
        .innerJoin(subjectsLive, eq(subjectsLive.id, standardSubjectsLive.subjectId))
        .where(eq(standardsLive.academicYearId, academicYearId))
        .orderBy(asc(subjectsLive.name));
    });
  }

  async create(data: CreateSubjectData): Promise<CreateSubjectResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      // Foreign keys accept any institute's row; the views under RLS do not.
      const standardIds = [...new Set(data.standardIds ?? [])];
      const sectionIds = [...new Set(data.sectionIds ?? [])];
      if (standardIds.length > 0) {
        const found = await tx
          .select({ id: standardsLive.id })
          .from(standardsLive)
          .where(inArray(standardsLive.id, standardIds));
        if (found.length !== standardIds.length) return { kind: 'standard_not_found' };
      }
      if (sectionIds.length > 0) {
        const found = await tx
          .select({ id: sectionsLive.id })
          .from(sectionsLive)
          .where(inArray(sectionsLive.id, sectionIds));
        if (found.length !== sectionIds.length) return { kind: 'section_not_found' };
      }

      const rows = await tx
        .insert(subjects)
        .values({
          tenantId,
          name: data.name,
          shortName: data.shortName,
          boardCode: data.boardCode,
          type: (data.type as SubjectTypeEnum) ?? 'ACADEMIC',
          isMandatory: data.isMandatory,
          hasPractical: data.hasPractical,
          theoryMarks: data.theoryMarks,
          practicalMarks: data.practicalMarks,
          internalMarks: data.internalMarks,
          isElective: data.isElective,
          electiveGroup: data.electiveGroup,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(writeReturning);

      const subject = rows[0] as SubjectRecord;

      // Link to standards if provided
      if (standardIds.length > 0) {
        await tx.insert(standardSubjects).values(
          standardIds.map((standardId) => ({
            tenantId,
            subjectId: subject.id,
            standardId,
            createdBy: userId,
            updatedBy: userId,
          })),
        );
      }

      // Link to sections if provided
      if (sectionIds.length > 0) {
        await tx.insert(sectionSubjects).values(
          sectionIds.map((sectionId) => ({
            tenantId,
            subjectId: subject.id,
            sectionId,
            createdBy: userId,
            updatedBy: userId,
          })),
        );
      }

      return { kind: 'ok', record: subject };
    });
  }

  async update(id: string, data: UpdateSubjectData): Promise<SubjectRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const rows = await tx
        .update(subjects)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.shortName !== undefined && { shortName: data.shortName }),
          ...(data.boardCode !== undefined && { boardCode: data.boardCode }),
          ...(data.type !== undefined && { type: data.type as SubjectTypeEnum }),
          ...(data.isMandatory !== undefined && { isMandatory: data.isMandatory }),
          ...(data.hasPractical !== undefined && { hasPractical: data.hasPractical }),
          ...(data.theoryMarks !== undefined && { theoryMarks: data.theoryMarks }),
          ...(data.practicalMarks !== undefined && { practicalMarks: data.practicalMarks }),
          ...(data.internalMarks !== undefined && { internalMarks: data.internalMarks }),
          ...(data.isElective !== undefined && { isElective: data.isElective }),
          ...(data.electiveGroup !== undefined && { electiveGroup: data.electiveGroup }),
          updatedBy: userId,
        })
        .where(and(eq(subjects.id, id), isNull(subjects.deletedAt)))
        .returning(writeReturning);

      if (rows.length === 0)
        throw new BusinessException(ErrorCode.SUBJECT_NOT_FOUND, `Subject ${id} not found`);
      return rows[0] as SubjectRecord;
    });
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      await softDelete(tx, subjects, id);
    });
  }

  async assignToStandard(subjectId: string, standardId: string): Promise<SubjectLinkResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const missing = await this.missingForStandardLink(tx, subjectId, standardId);
      if (missing) return missing;
      await tx
        .insert(standardSubjects)
        .values({ tenantId, subjectId, standardId, createdBy: userId, updatedBy: userId })
        .onConflictDoNothing();
      return { kind: 'ok' };
    });
  }

  async removeFromStandard(subjectId: string, standardId: string): Promise<SubjectLinkResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const missing = await this.missingForStandardLink(tx, subjectId, standardId);
      if (missing) return missing;
      await tx
        .update(standardSubjects)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(
          and(
            eq(standardSubjects.subjectId, subjectId),
            eq(standardSubjects.standardId, standardId),
            isNull(standardSubjects.deletedAt),
          ),
        );
      return { kind: 'ok' };
    });
  }

  async assignToSection(subjectId: string, sectionId: string): Promise<SubjectLinkResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const missing = await this.missingForSectionLink(tx, subjectId, sectionId);
      if (missing) return missing;
      await tx
        .insert(sectionSubjects)
        .values({ tenantId, subjectId, sectionId, createdBy: userId, updatedBy: userId })
        .onConflictDoNothing();
      return { kind: 'ok' };
    });
  }

  async removeFromSection(subjectId: string, sectionId: string): Promise<SubjectLinkResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:subject'), async (tx) => {
      const missing = await this.missingForSectionLink(tx, subjectId, sectionId);
      if (missing) return missing;
      await tx
        .update(sectionSubjects)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(
          and(
            eq(sectionSubjects.subjectId, subjectId),
            eq(sectionSubjects.sectionId, sectionId),
            isNull(sectionSubjects.deletedAt),
          ),
        );
      return { kind: 'ok' };
    });
  }

  // Foreign keys accept any institute's row; these reads under RLS do not.
  private async subjectExists(tx: DrizzleDB, subjectId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: subjectsLive.id })
      .from(subjectsLive)
      .where(eq(subjectsLive.id, subjectId))
      .limit(1);
    return row !== undefined;
  }

  private async missingForStandardLink(
    tx: DrizzleDB,
    subjectId: string,
    standardId: string,
  ): Promise<SubjectLinkFailure | null> {
    if (!(await this.subjectExists(tx, subjectId))) return { kind: 'subject_not_found' };
    const [standard] = await tx
      .select({ id: standardsLive.id })
      .from(standardsLive)
      .where(eq(standardsLive.id, standardId))
      .limit(1);
    return standard ? null : { kind: 'standard_not_found' };
  }

  private async missingForSectionLink(
    tx: DrizzleDB,
    subjectId: string,
    sectionId: string,
  ): Promise<SubjectLinkFailure | null> {
    if (!(await this.subjectExists(tx, subjectId))) return { kind: 'subject_not_found' };
    const [section] = await tx
      .select({ id: sectionsLive.id })
      .from(sectionsLive)
      .where(eq(sectionsLive.id, sectionId))
      .limit(1);
    return section ? null : { kind: 'section_not_found' };
  }
}
