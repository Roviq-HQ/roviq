import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ExamStatus, GradingSchemeKind, ReportCardStatus } from '@roviq/common-types';
import {
  attendanceEntriesLive,
  attendanceSessionsLive,
  coScholasticAreas,
  coScholasticAreasLive,
  coScholasticAssessments,
  coScholasticAssessmentsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  examMarks,
  examMarksLive,
  examSchedules,
  examSchedulesLive,
  exams,
  examsLive,
  examTerms,
  examTermsLive,
  examTopicAssessments,
  examTopicAssessmentsLive,
  gradeBands,
  gradeBandsLive,
  gradingSchemes,
  gradingSchemesLive,
  i18nDisplay,
  mkInstituteCtx,
  reportCardInstances,
  reportCardInstancesLive,
  reportCards,
  reportCardsLive,
  sectionsLive,
  softDelete,
  staffProfilesLive,
  standardsLive,
  studentAcademicsLive,
  studentProfilesLive,
  subjectsLive,
  subjectTopics,
  subjectTopicsLive,
  userProfiles,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, between, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ExaminationRepository } from './examination.repository';
import type {
  AttendanceTally,
  CoScholasticAreaRecord,
  CoScholasticAssessmentRecord,
  CreateCoScholasticAreaData,
  CreateExamData,
  CreateExamScheduleData,
  CreateExamTermData,
  CreateGradingSchemeData,
  CreateReportCardData,
  CreateSubjectTopicData,
  ExamLabelMaps,
  ExamMarkRecord,
  ExamRecord,
  ExamScheduleRecord,
  ExamTermRecord,
  ExamTopicAssessmentRecord,
  GradeBandData,
  GradeBandRecord,
  GradingSchemeRecord,
  ListExamsQuery,
  PaginatedExams,
  ReportCardInstanceRecord,
  ReportCardRecord,
  RosterStudent,
  SubjectTopicRecord,
  UpdateExamData,
  UpdateExamScheduleData,
  UpsertCoScholasticAssessmentData,
  UpsertExamMarkData,
  UpsertReportCardInstanceData,
  UpsertTopicAssessmentData,
} from './types';

const schemeCols = {
  id: gradingSchemesLive.id,
  tenantId: gradingSchemesLive.tenantId,
  name: gradingSchemesLive.name,
  kind: gradingSchemesLive.kind,
  board: gradingSchemesLive.board,
  isDefault: gradingSchemesLive.isDefault,
  createdAt: gradingSchemesLive.createdAt,
  updatedAt: gradingSchemesLive.updatedAt,
} as const;

const bandCols = {
  id: gradeBandsLive.id,
  tenantId: gradeBandsLive.tenantId,
  gradingSchemeId: gradeBandsLive.gradingSchemeId,
  grade: gradeBandsLive.grade,
  minPercent: gradeBandsLive.minPercent,
  maxPercent: gradeBandsLive.maxPercent,
  gradePoint: gradeBandsLive.gradePoint,
  descriptor: gradeBandsLive.descriptor,
  isPassing: gradeBandsLive.isPassing,
  sequence: gradeBandsLive.sequence,
  createdAt: gradeBandsLive.createdAt,
  updatedAt: gradeBandsLive.updatedAt,
} as const;

const termCols = {
  id: examTermsLive.id,
  tenantId: examTermsLive.tenantId,
  academicYearId: examTermsLive.academicYearId,
  name: examTermsLive.name,
  sequence: examTermsLive.sequence,
  weightInFinal: examTermsLive.weightInFinal,
  createdAt: examTermsLive.createdAt,
  updatedAt: examTermsLive.updatedAt,
} as const;

const examCols = {
  id: examsLive.id,
  tenantId: examsLive.tenantId,
  academicYearId: examsLive.academicYearId,
  examTermId: examsLive.examTermId,
  name: examsLive.name,
  type: examsLive.type,
  gradingSchemeId: examsLive.gradingSchemeId,
  status: examsLive.status,
  startDate: examsLive.startDate,
  endDate: examsLive.endDate,
  weightInTerm: examsLive.weightInTerm,
  description: examsLive.description,
  createdAt: examsLive.createdAt,
  updatedAt: examsLive.updatedAt,
} as const;

const examWrite = {
  id: exams.id,
  tenantId: exams.tenantId,
  academicYearId: exams.academicYearId,
  examTermId: exams.examTermId,
  name: exams.name,
  type: exams.type,
  gradingSchemeId: exams.gradingSchemeId,
  status: exams.status,
  startDate: exams.startDate,
  endDate: exams.endDate,
  weightInTerm: exams.weightInTerm,
  description: exams.description,
  createdAt: exams.createdAt,
  updatedAt: exams.updatedAt,
} as const;

const scheduleCols = {
  id: examSchedulesLive.id,
  tenantId: examSchedulesLive.tenantId,
  examId: examSchedulesLive.examId,
  sectionId: examSchedulesLive.sectionId,
  subjectId: examSchedulesLive.subjectId,
  component: examSchedulesLive.component,
  examDate: examSchedulesLive.examDate,
  startTime: examSchedulesLive.startTime,
  endTime: examSchedulesLive.endTime,
  maxMarks: examSchedulesLive.maxMarks,
  passMarks: examSchedulesLive.passMarks,
  room: examSchedulesLive.room,
  invigilatorId: examSchedulesLive.invigilatorId,
  createdAt: examSchedulesLive.createdAt,
  updatedAt: examSchedulesLive.updatedAt,
} as const;

const scheduleWrite = {
  id: examSchedules.id,
  tenantId: examSchedules.tenantId,
  examId: examSchedules.examId,
  sectionId: examSchedules.sectionId,
  subjectId: examSchedules.subjectId,
  component: examSchedules.component,
  examDate: examSchedules.examDate,
  startTime: examSchedules.startTime,
  endTime: examSchedules.endTime,
  maxMarks: examSchedules.maxMarks,
  passMarks: examSchedules.passMarks,
  room: examSchedules.room,
  invigilatorId: examSchedules.invigilatorId,
  createdAt: examSchedules.createdAt,
  updatedAt: examSchedules.updatedAt,
} as const;

const markCols = {
  id: examMarksLive.id,
  tenantId: examMarksLive.tenantId,
  examScheduleId: examMarksLive.examScheduleId,
  studentId: examMarksLive.studentId,
  obtainedMarks: examMarksLive.obtainedMarks,
  isAbsent: examMarksLive.isAbsent,
  isExempted: examMarksLive.isExempted,
  remarks: examMarksLive.remarks,
  version: examMarksLive.version,
  createdAt: examMarksLive.createdAt,
  updatedAt: examMarksLive.updatedAt,
} as const;

const markWrite = {
  id: examMarks.id,
  tenantId: examMarks.tenantId,
  examScheduleId: examMarks.examScheduleId,
  studentId: examMarks.studentId,
  obtainedMarks: examMarks.obtainedMarks,
  isAbsent: examMarks.isAbsent,
  isExempted: examMarks.isExempted,
  remarks: examMarks.remarks,
  version: examMarks.version,
  createdAt: examMarks.createdAt,
  updatedAt: examMarks.updatedAt,
} as const;

/** Normalise an optional number to `number | null` for a `mode: 'number'` column. */
function dec(n: number | null | undefined): number | null {
  return n ?? null;
}

@Injectable()
export class ExaminationDrizzleRepository extends ExaminationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  private ctx() {
    return mkInstituteCtx(this.getTenantId(), 'repository:examination');
  }

  // ── Grading schemes + bands ──────────────────────────────────────────────

  async createGradingScheme(
    data: CreateGradingSchemeData,
    bands: GradeBandData[],
  ): Promise<GradingSchemeRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(gradingSchemes)
        .values({
          tenantId,
          name: data.name,
          kind: data.kind,
          board: data.board ?? null,
          isDefault: data.isDefault ?? false,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({
          id: gradingSchemes.id,
          tenantId: gradingSchemes.tenantId,
          name: gradingSchemes.name,
          kind: gradingSchemes.kind,
          board: gradingSchemes.board,
          isDefault: gradingSchemes.isDefault,
          createdAt: gradingSchemes.createdAt,
          updatedAt: gradingSchemes.updatedAt,
        });
      const scheme = rows[0] as GradingSchemeRecord;
      if (bands.length > 0) {
        await tx.insert(gradeBands).values(
          bands.map((b, i) => ({
            tenantId,
            gradingSchemeId: scheme.id,
            grade: b.grade,
            minPercent: dec(b.minPercent),
            maxPercent: dec(b.maxPercent),
            gradePoint: dec(b.gradePoint),
            descriptor: b.descriptor ?? null,
            isPassing: b.isPassing ?? true,
            sequence: b.sequence ?? i,
            createdBy: userId,
            updatedBy: userId,
          })),
        );
      }
      return scheme;
    });
  }

  async updateGradingScheme(
    id: string,
    data: Partial<CreateGradingSchemeData>,
  ): Promise<GradingSchemeRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(gradingSchemes)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.board !== undefined && { board: data.board }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          updatedBy: userId,
        })
        .where(and(eq(gradingSchemes.id, id), isNull(gradingSchemes.deletedAt)))
        .returning({
          id: gradingSchemes.id,
          tenantId: gradingSchemes.tenantId,
          name: gradingSchemes.name,
          kind: gradingSchemes.kind,
          board: gradingSchemes.board,
          isDefault: gradingSchemes.isDefault,
          createdAt: gradingSchemes.createdAt,
          updatedAt: gradingSchemes.updatedAt,
        });
      if (rows.length === 0) throw new NotFoundException(`Grading scheme ${id} not found`);
      return rows[0] as GradingSchemeRecord;
    });
  }

  async replaceBands(gradingSchemeId: string, bands: GradeBandData[]): Promise<GradeBandRecord[]> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      await tx
        .update(gradeBands)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(and(eq(gradeBands.gradingSchemeId, gradingSchemeId), isNull(gradeBands.deletedAt)));
      if (bands.length === 0) return [];
      return tx
        .insert(gradeBands)
        .values(
          bands.map((b, i) => ({
            tenantId,
            gradingSchemeId,
            grade: b.grade,
            minPercent: dec(b.minPercent),
            maxPercent: dec(b.maxPercent),
            gradePoint: dec(b.gradePoint),
            descriptor: b.descriptor ?? null,
            isPassing: b.isPassing ?? true,
            sequence: b.sequence ?? i,
            createdBy: userId,
            updatedBy: userId,
          })),
        )
        .returning({
          id: gradeBands.id,
          tenantId: gradeBands.tenantId,
          gradingSchemeId: gradeBands.gradingSchemeId,
          grade: gradeBands.grade,
          minPercent: gradeBands.minPercent,
          maxPercent: gradeBands.maxPercent,
          gradePoint: gradeBands.gradePoint,
          descriptor: gradeBands.descriptor,
          isPassing: gradeBands.isPassing,
          sequence: gradeBands.sequence,
          createdAt: gradeBands.createdAt,
          updatedAt: gradeBands.updatedAt,
        }) as Promise<GradeBandRecord[]>;
    });
  }

  async findGradingSchemeById(id: string): Promise<GradingSchemeRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(schemeCols)
        .from(gradingSchemesLive)
        .where(eq(gradingSchemesLive.id, id));
      return (rows[0] as GradingSchemeRecord | undefined) ?? null;
    });
  }

  async listGradingSchemes(kind?: GradingSchemeKind): Promise<GradingSchemeRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const where = kind ? eq(gradingSchemesLive.kind, kind) : undefined;
      return tx
        .select(schemeCols)
        .from(gradingSchemesLive)
        .where(where)
        .orderBy(asc(gradingSchemesLive.createdAt)) as Promise<GradingSchemeRecord[]>;
    });
  }

  async findBands(gradingSchemeId: string): Promise<GradeBandRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(bandCols)
        .from(gradeBandsLive)
        .where(eq(gradeBandsLive.gradingSchemeId, gradingSchemeId))
        .orderBy(asc(gradeBandsLive.sequence)) as Promise<GradeBandRecord[]>;
    });
  }

  async findDefaultScheme(kind: GradingSchemeKind): Promise<GradingSchemeRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(schemeCols)
        .from(gradingSchemesLive)
        .where(and(eq(gradingSchemesLive.kind, kind), eq(gradingSchemesLive.isDefault, true)))
        .limit(1);
      return (rows[0] as GradingSchemeRecord | undefined) ?? null;
    });
  }

  async softDeleteGradingScheme(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, gradingSchemes, id);
    });
  }

  async countSchemeReferences(gradingSchemeId: string): Promise<number> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const [examRefs, areaRefs, cardRefs] = await Promise.all([
        tx
          .select({ value: count() })
          .from(examsLive)
          .where(eq(examsLive.gradingSchemeId, gradingSchemeId)),
        tx
          .select({ value: count() })
          .from(coScholasticAreasLive)
          .where(eq(coScholasticAreasLive.gradingSchemeId, gradingSchemeId)),
        tx
          .select({ value: count() })
          .from(reportCardsLive)
          .where(eq(reportCardsLive.gradingSchemeId, gradingSchemeId)),
      ]);
      return (
        Number(examRefs[0]?.value ?? 0) +
        Number(areaRefs[0]?.value ?? 0) +
        Number(cardRefs[0]?.value ?? 0)
      );
    });
  }

  // ── Exam terms ────────────────────────────────────────────────────────────

  async createExamTerm(data: CreateExamTermData): Promise<ExamTermRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(examTerms)
        .values({
          tenantId,
          academicYearId: data.academicYearId,
          name: data.name,
          sequence: data.sequence ?? 0,
          weightInFinal: dec(data.weightInFinal ?? 0) ?? 0,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({
          id: examTerms.id,
          tenantId: examTerms.tenantId,
          academicYearId: examTerms.academicYearId,
          name: examTerms.name,
          sequence: examTerms.sequence,
          weightInFinal: examTerms.weightInFinal,
          createdAt: examTerms.createdAt,
          updatedAt: examTerms.updatedAt,
        });
      return rows[0] as ExamTermRecord;
    });
  }

  async updateExamTerm(id: string, data: Partial<CreateExamTermData>): Promise<ExamTermRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(examTerms)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.sequence !== undefined && { sequence: data.sequence }),
          ...(data.weightInFinal !== undefined && { weightInFinal: dec(data.weightInFinal) ?? 0 }),
          updatedBy: userId,
        })
        .where(and(eq(examTerms.id, id), isNull(examTerms.deletedAt)))
        .returning({
          id: examTerms.id,
          tenantId: examTerms.tenantId,
          academicYearId: examTerms.academicYearId,
          name: examTerms.name,
          sequence: examTerms.sequence,
          weightInFinal: examTerms.weightInFinal,
          createdAt: examTerms.createdAt,
          updatedAt: examTerms.updatedAt,
        });
      if (rows.length === 0) throw new NotFoundException(`Exam term ${id} not found`);
      return rows[0] as ExamTermRecord;
    });
  }

  async listExamTerms(academicYearId: string): Promise<ExamTermRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(termCols)
        .from(examTermsLive)
        .where(eq(examTermsLive.academicYearId, academicYearId))
        .orderBy(asc(examTermsLive.sequence)) as Promise<ExamTermRecord[]>;
    });
  }

  async findExamTermById(id: string): Promise<ExamTermRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx.select(termCols).from(examTermsLive).where(eq(examTermsLive.id, id));
      return (rows[0] as ExamTermRecord | undefined) ?? null;
    });
  }

  async softDeleteExamTerm(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, examTerms, id);
    });
  }

  // ── Exams ─────────────────────────────────────────────────────────────────

  async createExam(data: CreateExamData): Promise<ExamRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(exams)
        .values({
          tenantId,
          academicYearId: data.academicYearId,
          examTermId: data.examTermId ?? null,
          name: data.name,
          type: data.type,
          gradingSchemeId: data.gradingSchemeId ?? null,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          weightInTerm: dec(data.weightInTerm ?? 100) ?? 100,
          description: data.description ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(examWrite);
      return rows[0] as ExamRecord;
    });
  }

  async findExamById(id: string): Promise<ExamRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx.select(examCols).from(examsLive).where(eq(examsLive.id, id));
      return (rows[0] as ExamRecord | undefined) ?? null;
    });
  }

  async listExams(query: ListExamsQuery): Promise<PaginatedExams> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const conditions = [];
      if (query.academicYearId) conditions.push(eq(examsLive.academicYearId, query.academicYearId));
      if (query.examTermId) conditions.push(eq(examsLive.examTermId, query.examTermId));
      if (query.status) conditions.push(eq(examsLive.status, query.status));
      if (query.search) {
        conditions.push(sql`${examsLive.name}::text ILIKE ${`%${query.search}%`}`);
      }
      if (query.sectionId) {
        const covered = tx
          .select({ id: examSchedulesLive.examId })
          .from(examSchedulesLive)
          .where(eq(examSchedulesLive.sectionId, query.sectionId));
        conditions.push(sql`${examsLive.id} IN ${covered}`);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const totalRows = await tx.select({ value: count() }).from(examsLive).where(where);
      const total = Number(totalRows[0]?.value ?? 0);
      const docs = (await tx
        .select(examCols)
        .from(examsLive)
        .where(where)
        .orderBy(desc(examsLive.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage)) as ExamRecord[];
      return {
        docs,
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      };
    });
  }

  async updateExam(id: string, data: UpdateExamData): Promise<ExamRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(exams)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.examTermId !== undefined && { examTermId: data.examTermId }),
          ...(data.gradingSchemeId !== undefined && { gradingSchemeId: data.gradingSchemeId }),
          ...(data.startDate !== undefined && { startDate: data.startDate }),
          ...(data.endDate !== undefined && { endDate: data.endDate }),
          ...(data.weightInTerm !== undefined && { weightInTerm: dec(data.weightInTerm) ?? 100 }),
          ...(data.description !== undefined && { description: data.description }),
          updatedBy: userId,
        })
        .where(and(eq(exams.id, id), isNull(exams.deletedAt)))
        .returning(examWrite);
      if (rows.length === 0) throw new NotFoundException(`Exam ${id} not found`);
      return rows[0] as ExamRecord;
    });
  }

  async setExamStatus(id: string, status: ExamStatus): Promise<ExamRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(exams)
        .set({ status, updatedBy: userId })
        .where(and(eq(exams.id, id), isNull(exams.deletedAt)))
        .returning(examWrite);
      if (rows.length === 0) throw new NotFoundException(`Exam ${id} not found`);
      return rows[0] as ExamRecord;
    });
  }

  async softDeleteExam(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, exams, id);
    });
  }

  async restoreExam(id: string): Promise<ExamRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(exams)
        .set({ deletedAt: null, deletedBy: null, updatedBy: userId })
        .where(eq(exams.id, id))
        .returning(examWrite);
      if (rows.length === 0) throw new NotFoundException(`Exam ${id} not found`);
      return rows[0] as ExamRecord;
    });
  }

  // ── Exam schedules ──────────────────────────────────────────────────────────

  async createSchedule(data: CreateExamScheduleData): Promise<ExamScheduleRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(examSchedules)
        .values({
          tenantId,
          examId: data.examId,
          sectionId: data.sectionId,
          subjectId: data.subjectId,
          component: data.component,
          examDate: data.examDate ?? null,
          startTime: data.startTime ?? null,
          endTime: data.endTime ?? null,
          maxMarks: dec(data.maxMarks) ?? 0,
          passMarks: dec(data.passMarks),
          room: data.room ?? null,
          invigilatorId: data.invigilatorId ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(scheduleWrite);
      return rows[0] as ExamScheduleRecord;
    });
  }

  async updateSchedule(id: string, data: UpdateExamScheduleData): Promise<ExamScheduleRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(examSchedules)
        .set({
          ...(data.component !== undefined && { component: data.component }),
          ...(data.examDate !== undefined && { examDate: data.examDate }),
          ...(data.startTime !== undefined && { startTime: data.startTime }),
          ...(data.endTime !== undefined && { endTime: data.endTime }),
          ...(data.maxMarks !== undefined && { maxMarks: dec(data.maxMarks) ?? 0 }),
          ...(data.passMarks !== undefined && { passMarks: dec(data.passMarks) }),
          ...(data.room !== undefined && { room: data.room }),
          ...(data.invigilatorId !== undefined && { invigilatorId: data.invigilatorId }),
          updatedBy: userId,
        })
        .where(and(eq(examSchedules.id, id), isNull(examSchedules.deletedAt)))
        .returning(scheduleWrite);
      if (rows.length === 0) throw new NotFoundException(`Exam schedule ${id} not found`);
      return rows[0] as ExamScheduleRecord;
    });
  }

  async findScheduleById(id: string): Promise<ExamScheduleRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select(scheduleCols)
        .from(examSchedulesLive)
        .where(eq(examSchedulesLive.id, id));
      return (rows[0] as ExamScheduleRecord | undefined) ?? null;
    });
  }

  async findSchedulesByExam(examId: string): Promise<ExamScheduleRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(scheduleCols)
        .from(examSchedulesLive)
        .where(eq(examSchedulesLive.examId, examId)) as Promise<ExamScheduleRecord[]>;
    });
  }

  async findSchedulesByExamSection(
    examId: string,
    sectionId: string,
  ): Promise<ExamScheduleRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(scheduleCols)
        .from(examSchedulesLive)
        .where(
          and(eq(examSchedulesLive.examId, examId), eq(examSchedulesLive.sectionId, sectionId)),
        ) as Promise<ExamScheduleRecord[]>;
    });
  }

  async softDeleteSchedule(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, examSchedules, id);
    });
  }

  // ── Exam marks ────────────────────────────────────────────────────────────

  async upsertMarks(data: UpsertExamMarkData[]): Promise<ExamMarkRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const out: ExamMarkRecord[] = [];
      for (const item of data) {
        const existing = await tx
          .select({ id: examMarksLive.id })
          .from(examMarksLive)
          .where(
            and(
              eq(examMarksLive.examScheduleId, item.examScheduleId),
              eq(examMarksLive.studentId, item.studentId),
            ),
          );
        if (existing[0]?.id) {
          const rows = await tx
            .update(examMarks)
            .set({
              obtainedMarks: dec(item.obtainedMarks),
              isAbsent: item.isAbsent ?? false,
              isExempted: item.isExempted ?? false,
              remarks: item.remarks ?? null,
              version: sql`${examMarks.version} + 1`,
              updatedBy: userId,
            })
            .where(and(eq(examMarks.id, existing[0].id), isNull(examMarks.deletedAt)))
            .returning(markWrite);
          out.push(rows[0] as ExamMarkRecord);
        } else {
          const rows = await tx
            .insert(examMarks)
            .values({
              tenantId,
              examScheduleId: item.examScheduleId,
              studentId: item.studentId,
              obtainedMarks: dec(item.obtainedMarks),
              isAbsent: item.isAbsent ?? false,
              isExempted: item.isExempted ?? false,
              remarks: item.remarks ?? null,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning(markWrite);
          out.push(rows[0] as ExamMarkRecord);
        }
      }
      return out;
    });
  }

  async findMarksBySchedule(examScheduleId: string): Promise<ExamMarkRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(markCols)
        .from(examMarksLive)
        .where(eq(examMarksLive.examScheduleId, examScheduleId)) as Promise<ExamMarkRecord[]>;
    });
  }

  async findMarksByExamSection(examId: string, sectionId: string): Promise<ExamMarkRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const scheduleIds = tx
        .select({ id: examSchedulesLive.id })
        .from(examSchedulesLive)
        .where(
          and(eq(examSchedulesLive.examId, examId), eq(examSchedulesLive.sectionId, sectionId)),
        );
      return tx
        .select(markCols)
        .from(examMarksLive)
        .where(sql`${examMarksLive.examScheduleId} IN ${scheduleIds}`) as Promise<ExamMarkRecord[]>;
    });
  }

  // ── Cross-entity reads ──────────────────────────────────────────────────────

  async listSectionRoster(sectionId: string, academicYearId: string): Promise<RosterStudent[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select({
          studentProfileId: studentProfilesLive.id,
          membershipId: studentProfilesLive.membershipId,
          rollNumber: studentAcademicsLive.rollNumber,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
        })
        .from(studentAcademicsLive)
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
        )
        .innerJoin(userProfiles, eq(userProfiles.userId, studentProfilesLive.userId))
        .where(
          and(
            eq(studentAcademicsLive.sectionId, sectionId),
            eq(studentAcademicsLive.academicYearId, academicYearId),
          ),
        )
        .orderBy(asc(studentAcademicsLive.rollNumber)) as Promise<RosterStudent[]>;
    });
  }

  async resolveLabels(input: {
    subjectIds: string[];
    sectionIds: string[];
    studentMembershipIds: string[];
    staffMembershipIds: string[];
  }): Promise<ExamLabelMaps> {
    const subjectIds = [...new Set(input.subjectIds)];
    const sectionIds = [...new Set(input.sectionIds)];
    const studentIds = [...new Set(input.studentMembershipIds)];
    const staffIds = [...new Set(input.staffMembershipIds)];
    return withTenant(this.db, this.ctx(), async (tx) => {
      const subjects: Record<string, string> = {};
      const sections: Record<string, string> = {};
      const students: Record<string, string> = {};
      const staff: Record<string, string> = {};

      if (subjectIds.length > 0) {
        const rows = await tx
          .select({ id: subjectsLive.id, name: subjectsLive.name })
          .from(subjectsLive)
          .where(inArray(subjectsLive.id, subjectIds));
        for (const r of rows) subjects[r.id] = r.name;
      }
      if (sectionIds.length > 0) {
        const rows = await tx
          .select({
            id: sectionsLive.id,
            name: sectionsLive.name,
            displayLabel: sectionsLive.displayLabel,
            standardName: standardsLive.name,
          })
          .from(sectionsLive)
          .innerJoin(standardsLive, eq(standardsLive.id, sectionsLive.standardId))
          .where(inArray(sectionsLive.id, sectionIds));
        for (const r of rows) {
          const section = r.displayLabel ?? i18nDisplay(r.name);
          sections[r.id] = `${i18nDisplay(r.standardName)} - ${section}`;
        }
      }
      if (studentIds.length > 0) {
        const rows = await tx
          .select({
            membershipId: studentProfilesLive.membershipId,
            firstName: userProfiles.firstName,
            lastName: userProfiles.lastName,
          })
          .from(studentProfilesLive)
          .innerJoin(userProfiles, eq(userProfiles.userId, studentProfilesLive.userId))
          .where(inArray(studentProfilesLive.membershipId, studentIds));
        for (const r of rows) {
          students[r.membershipId] =
            `${i18nDisplay(r.firstName)} ${i18nDisplay(r.lastName)}`.trim();
        }
      }
      if (staffIds.length > 0) {
        const rows = await tx
          .select({
            membershipId: staffProfilesLive.membershipId,
            firstName: userProfiles.firstName,
            lastName: userProfiles.lastName,
          })
          .from(staffProfilesLive)
          .innerJoin(userProfiles, eq(userProfiles.userId, staffProfilesLive.userId))
          .where(inArray(staffProfilesLive.membershipId, staffIds));
        for (const r of rows) {
          staff[r.membershipId] = `${i18nDisplay(r.firstName)} ${i18nDisplay(r.lastName)}`.trim();
        }
      }
      return { subjects, sections, students, staff };
    });
  }

  async attendanceTally(
    studentId: string,
    academicYearId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AttendanceTally> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select({
          present: sql<number>`count(*) filter (where ${attendanceEntriesLive.status} = 'PRESENT')`,
          // Holidays are absence-of-entries, not a status — every entry is a working day.
          total: sql<number>`count(*)`,
        })
        .from(attendanceEntriesLive)
        .innerJoin(
          attendanceSessionsLive,
          eq(attendanceSessionsLive.id, attendanceEntriesLive.sessionId),
        )
        .where(
          and(
            eq(attendanceEntriesLive.studentId, studentId),
            eq(attendanceSessionsLive.academicYearId, academicYearId),
            between(attendanceSessionsLive.date, fromDate, toDate),
          ),
        );
      return { present: Number(rows[0]?.present ?? 0), total: Number(rows[0]?.total ?? 0) };
    });
  }

  // ── NEP subject topics ───────────────────────────────────────────────────

  async createSubjectTopic(data: CreateSubjectTopicData): Promise<SubjectTopicRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(subjectTopics)
        .values({
          tenantId,
          subjectId: data.subjectId,
          standardId: data.standardId ?? null,
          name: data.name,
          code: data.code ?? null,
          learningOutcome: data.learningOutcome ?? null,
          sequence: data.sequence ?? 0,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return rows[0] as SubjectTopicRecord;
    });
  }

  async listSubjectTopics(subjectId: string, standardId?: string): Promise<SubjectTopicRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const conditions = [eq(subjectTopicsLive.subjectId, subjectId)];
      if (standardId) conditions.push(eq(subjectTopicsLive.standardId, standardId));
      return tx
        .select()
        .from(subjectTopicsLive)
        .where(and(...conditions))
        .orderBy(asc(subjectTopicsLive.sequence)) as Promise<SubjectTopicRecord[]>;
    });
  }

  async listSubjectTopicsForSubjects(subjectIds: string[]): Promise<SubjectTopicRecord[]> {
    const ids = [...new Set(subjectIds)];
    if (ids.length === 0) return [];
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(subjectTopicsLive)
        .where(inArray(subjectTopicsLive.subjectId, ids))
        .orderBy(asc(subjectTopicsLive.sequence)) as Promise<SubjectTopicRecord[]>;
    });
  }

  async softDeleteSubjectTopic(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, subjectTopics, id);
    });
  }

  // ── Topic assessments ──────────────────────────────────────────────────────

  async upsertTopicAssessments(
    data: UpsertTopicAssessmentData[],
  ): Promise<ExamTopicAssessmentRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const out: ExamTopicAssessmentRecord[] = [];
      for (const item of data) {
        const existing = await tx
          .select({ id: examTopicAssessmentsLive.id })
          .from(examTopicAssessmentsLive)
          .where(
            and(
              eq(examTopicAssessmentsLive.examScheduleId, item.examScheduleId),
              eq(examTopicAssessmentsLive.studentId, item.studentId),
              eq(examTopicAssessmentsLive.subjectTopicId, item.subjectTopicId),
            ),
          );
        if (existing[0]?.id) {
          const rows = await tx
            .update(examTopicAssessments)
            .set({
              competencyLevel: item.competencyLevel,
              descriptor: item.descriptor ?? null,
              updatedBy: userId,
            })
            .where(
              and(
                eq(examTopicAssessments.id, existing[0].id),
                isNull(examTopicAssessments.deletedAt),
              ),
            )
            .returning();
          out.push(rows[0] as ExamTopicAssessmentRecord);
        } else {
          const rows = await tx
            .insert(examTopicAssessments)
            .values({
              tenantId,
              examScheduleId: item.examScheduleId,
              studentId: item.studentId,
              subjectTopicId: item.subjectTopicId,
              competencyLevel: item.competencyLevel,
              descriptor: item.descriptor ?? null,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning();
          out.push(rows[0] as ExamTopicAssessmentRecord);
        }
      }
      return out;
    });
  }

  async findTopicAssessmentsByExamSection(
    examId: string,
    sectionId: string,
  ): Promise<ExamTopicAssessmentRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const scheduleIds = tx
        .select({ id: examSchedulesLive.id })
        .from(examSchedulesLive)
        .where(
          and(eq(examSchedulesLive.examId, examId), eq(examSchedulesLive.sectionId, sectionId)),
        );
      return tx
        .select()
        .from(examTopicAssessmentsLive)
        .where(sql`${examTopicAssessmentsLive.examScheduleId} IN ${scheduleIds}`) as Promise<
        ExamTopicAssessmentRecord[]
      >;
    });
  }

  // ── Co-scholastic ────────────────────────────────────────────────────────────

  async createCoScholasticArea(data: CreateCoScholasticAreaData): Promise<CoScholasticAreaRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(coScholasticAreas)
        .values({
          tenantId,
          name: data.name,
          gradingSchemeId: data.gradingSchemeId ?? null,
          sequence: data.sequence ?? 0,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return rows[0] as CoScholasticAreaRecord;
    });
  }

  async listCoScholasticAreas(): Promise<CoScholasticAreaRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(coScholasticAreasLive)
        .orderBy(asc(coScholasticAreasLive.sequence)) as Promise<CoScholasticAreaRecord[]>;
    });
  }

  async softDeleteCoScholasticArea(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, coScholasticAreas, id);
    });
  }

  async upsertCoScholasticAssessments(
    data: UpsertCoScholasticAssessmentData[],
  ): Promise<CoScholasticAssessmentRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const out: CoScholasticAssessmentRecord[] = [];
      for (const item of data) {
        const existing = await tx
          .select({ id: coScholasticAssessmentsLive.id })
          .from(coScholasticAssessmentsLive)
          .where(
            and(
              eq(coScholasticAssessmentsLive.coScholasticAreaId, item.coScholasticAreaId),
              eq(coScholasticAssessmentsLive.studentId, item.studentId),
              eq(coScholasticAssessmentsLive.examTermId, item.examTermId),
            ),
          );
        if (existing[0]?.id) {
          const rows = await tx
            .update(coScholasticAssessments)
            .set({ grade: item.grade, descriptor: item.descriptor ?? null, updatedBy: userId })
            .where(
              and(
                eq(coScholasticAssessments.id, existing[0].id),
                isNull(coScholasticAssessments.deletedAt),
              ),
            )
            .returning();
          out.push(rows[0] as CoScholasticAssessmentRecord);
        } else {
          const rows = await tx
            .insert(coScholasticAssessments)
            .values({
              tenantId,
              coScholasticAreaId: item.coScholasticAreaId,
              studentId: item.studentId,
              examTermId: item.examTermId,
              grade: item.grade,
              descriptor: item.descriptor ?? null,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning();
          out.push(rows[0] as CoScholasticAssessmentRecord);
        }
      }
      return out;
    });
  }

  async findCoScholasticAssessments(examTermId: string): Promise<CoScholasticAssessmentRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(coScholasticAssessmentsLive)
        .where(eq(coScholasticAssessmentsLive.examTermId, examTermId)) as Promise<
        CoScholasticAssessmentRecord[]
      >;
    });
  }

  // ── Report cards ─────────────────────────────────────────────────────────────

  async createReportCard(data: CreateReportCardData): Promise<ReportCardRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .insert(reportCards)
        .values({
          tenantId,
          academicYearId: data.academicYearId,
          examTermId: data.examTermId ?? null,
          name: data.name,
          gradingSchemeId: data.gradingSchemeId ?? null,
          includeAttendance: data.includeAttendance ?? true,
          includeCoScholastic: data.includeCoScholastic ?? true,
          includeTopicWise: data.includeTopicWise ?? false,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return rows[0] as ReportCardRecord;
    });
  }

  async updateReportCard(
    id: string,
    data: Partial<CreateReportCardData>,
  ): Promise<ReportCardRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(reportCards)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.examTermId !== undefined && { examTermId: data.examTermId }),
          ...(data.gradingSchemeId !== undefined && { gradingSchemeId: data.gradingSchemeId }),
          ...(data.includeAttendance !== undefined && {
            includeAttendance: data.includeAttendance,
          }),
          ...(data.includeCoScholastic !== undefined && {
            includeCoScholastic: data.includeCoScholastic,
          }),
          ...(data.includeTopicWise !== undefined && { includeTopicWise: data.includeTopicWise }),
          updatedBy: userId,
        })
        .where(and(eq(reportCards.id, id), isNull(reportCards.deletedAt)))
        .returning();
      if (rows.length === 0) throw new NotFoundException(`Report card ${id} not found`);
      return rows[0] as ReportCardRecord;
    });
  }

  async listReportCards(academicYearId: string): Promise<ReportCardRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(reportCardsLive)
        .where(eq(reportCardsLive.academicYearId, academicYearId))
        .orderBy(desc(reportCardsLive.createdAt)) as Promise<ReportCardRecord[]>;
    });
  }

  async findReportCardById(id: string): Promise<ReportCardRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx.select().from(reportCardsLive).where(eq(reportCardsLive.id, id));
      return (rows[0] as ReportCardRecord | undefined) ?? null;
    });
  }

  async setReportCardStatus(id: string, status: ReportCardStatus): Promise<ReportCardRecord> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(reportCards)
        .set({ status, updatedBy: userId })
        .where(and(eq(reportCards.id, id), isNull(reportCards.deletedAt)))
        .returning();
      if (rows.length === 0) throw new NotFoundException(`Report card ${id} not found`);
      return rows[0] as ReportCardRecord;
    });
  }

  async softDeleteReportCard(id: string): Promise<void> {
    await withTenant(this.db, this.ctx(), async (tx) => {
      await softDelete(tx, reportCards, id);
    });
  }

  // ── Report card instances ──────────────────────────────────────────────────

  async upsertReportCardInstances(
    data: UpsertReportCardInstanceData[],
  ): Promise<ReportCardInstanceRecord[]> {
    if (data.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    const now = new Date();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const out: ReportCardInstanceRecord[] = [];
      for (const item of data) {
        const existing = await tx
          .select({ id: reportCardInstancesLive.id })
          .from(reportCardInstancesLive)
          .where(
            and(
              eq(reportCardInstancesLive.reportCardId, item.reportCardId),
              eq(reportCardInstancesLive.studentProfileId, item.studentProfileId),
            ),
          );
        const values = {
          sectionId: item.sectionId,
          academicYearId: item.academicYearId,
          status: 'GENERATED' as const,
          maxMarks: item.maxMarks,
          obtainedMarks: item.obtainedMarks,
          percentage: item.percentage,
          gpa: item.gpa,
          grade: item.grade,
          rank: item.rank,
          attendancePercent: item.attendancePercent,
          resultStatus: item.resultStatus,
          payload: item.payload,
          generatedAt: now,
        };
        if (existing[0]?.id) {
          const rows = await tx
            .update(reportCardInstances)
            .set({ ...values, updatedBy: userId })
            .where(
              and(
                eq(reportCardInstances.id, existing[0].id),
                isNull(reportCardInstances.deletedAt),
              ),
            )
            .returning();
          out.push(rows[0] as ReportCardInstanceRecord);
        } else {
          const rows = await tx
            .insert(reportCardInstances)
            .values({
              tenantId,
              reportCardId: item.reportCardId,
              studentProfileId: item.studentProfileId,
              ...values,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning();
          out.push(rows[0] as ReportCardInstanceRecord);
        }
      }
      return out;
    });
  }

  async findReportCardInstanceById(id: string): Promise<ReportCardInstanceRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select()
        .from(reportCardInstancesLive)
        .where(eq(reportCardInstancesLive.id, id));
      return (rows[0] as ReportCardInstanceRecord | undefined) ?? null;
    });
  }

  async findReportCardInstance(
    reportCardId: string,
    studentProfileId: string,
  ): Promise<ReportCardInstanceRecord | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select()
        .from(reportCardInstancesLive)
        .where(
          and(
            eq(reportCardInstancesLive.reportCardId, reportCardId),
            eq(reportCardInstancesLive.studentProfileId, studentProfileId),
          ),
        );
      return (rows[0] as ReportCardInstanceRecord | undefined) ?? null;
    });
  }

  async listReportCardInstances(reportCardId: string): Promise<ReportCardInstanceRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(reportCardInstancesLive)
        .where(eq(reportCardInstancesLive.reportCardId, reportCardId)) as Promise<
        ReportCardInstanceRecord[]
      >;
    });
  }

  async listReportCardInstancesByStudent(
    studentProfileId: string,
  ): Promise<ReportCardInstanceRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select()
        .from(reportCardInstancesLive)
        .where(
          and(
            eq(reportCardInstancesLive.studentProfileId, studentProfileId),
            eq(reportCardInstancesLive.status, 'PUBLISHED'),
          ),
        )
        .orderBy(desc(reportCardInstancesLive.createdAt)) as Promise<ReportCardInstanceRecord[]>;
    });
  }

  async publishReportCardInstances(reportCardId: string): Promise<number> {
    const { userId } = getRequestContext();
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .update(reportCardInstances)
        .set({ status: 'PUBLISHED', publishedAt: new Date(), updatedBy: userId })
        .where(
          and(
            eq(reportCardInstances.reportCardId, reportCardId),
            isNull(reportCardInstances.deletedAt),
          ),
        )
        .returning({ id: reportCardInstances.id });
      return rows.length;
    });
  }

  // ── Generation helpers ─────────────────────────────────────────────────────────

  async listExamsInTerm(examTermId: string): Promise<ExamRecord[]> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      return tx
        .select(examCols)
        .from(examsLive)
        .where(eq(examsLive.examTermId, examTermId)) as Promise<ExamRecord[]>;
    });
  }

  async findStudentProfileIdByMembership(membershipId: string): Promise<string | null> {
    return withTenant(this.db, this.ctx(), async (tx) => {
      const rows = await tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.membershipId, membershipId))
        .limit(1);
      return rows[0]?.id ?? null;
    });
  }
}
