import { Inject, Injectable } from '@nestjs/common';
import {
  academicYearsLive,
  attendanceEntriesLive,
  attendanceSessionsLive,
  coScholasticAssessmentsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  examMarksLive,
  examSchedulesLive,
  examsLive,
  examTermsLive,
  examTopicAssessmentsLive,
  instituteConfigsLive,
  mkInstituteCtx,
  reportCardInstancesLive,
  sectionsLive,
  standardsLive,
  studentAcademics,
  studentAcademicsLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { findClassInYear } from './class-lookup';
import { lockSectionForPlacement, strengthChange } from './section-strength';
import { StudentAcademicRepository } from './student-academic.repository';
import type {
  ChangeClassData,
  ChangeClassResult,
  ClassChangeRules,
  EnrolTargetData,
  EnrolTargetResult,
  PlacementResult,
  PromotionDecisionData,
  RemoveFromYearResult,
  SectionCapacityRecord,
  SectionStrengthChange,
  StudentAcademicHistoryRecord,
  StudentAcademicPlacementRecord,
} from './types';

const ORIGIN = 'service:student-academic';

@Injectable()
export class StudentAcademicDrizzleRepository extends StudentAcademicRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  listHistory(tenantId: string, studentProfileId: string): Promise<StudentAcademicHistoryRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .select({
          id: studentAcademicsLive.id,
          studentProfileId: studentAcademicsLive.studentProfileId,
          academicYearId: studentAcademicsLive.academicYearId,
          academicYearLabel: academicYearsLive.label,
          isCurrentYear: academicYearsLive.isActive,
          standardId: studentAcademicsLive.standardId,
          standardName: standardsLive.name,
          sectionId: studentAcademicsLive.sectionId,
          sectionName: sectionsLive.name,
          rollNumber: studentAcademicsLive.rollNumber,
          promotionStatus: studentAcademicsLive.promotionStatus,
          createdAt: studentAcademicsLive.createdAt,
          updatedAt: studentAcademicsLive.updatedAt,
        })
        .from(studentAcademicsLive)
        .innerJoin(academicYearsLive, eq(academicYearsLive.id, studentAcademicsLive.academicYearId))
        .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
        .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
        .where(eq(studentAcademicsLive.studentProfileId, studentProfileId))
        .orderBy(desc(academicYearsLive.startDate));

      return rows;
    });
  }

  checkEnrolTarget(tenantId: string, data: EnrolTargetData): Promise<EnrolTargetResult> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [student] = await tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, data.studentProfileId))
        .limit(1);
      if (!student) return { kind: 'student_not_found' };

      const [year] = await tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.id, data.academicYearId))
        .limit(1);
      if (!year) return { kind: 'year_not_found' };

      const placement = await findClassInYear(
        tx,
        data.academicYearId,
        data.standardId,
        data.sectionId,
      );
      return placement.kind === 'ok' ? { kind: 'ok' } : placement;
    });
  }

  findSectionCapacity(tenantId: string, sectionId: string): Promise<SectionCapacityRecord | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      this.readSectionCapacity(tx, sectionId),
    );
  }

  async createPlacement(
    tenantId: string,
    data: EnrolTargetData & { actorId: string },
  ): Promise<PlacementResult | null> {
    const result = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const locked = await lockSectionForPlacement(tx, data.sectionId);
      const rows = await tx
        .insert(studentAcademics)
        .values({
          studentProfileId: data.studentProfileId,
          academicYearId: data.academicYearId,
          standardId: data.standardId,
          sectionId: data.sectionId,
          tenantId,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        .onConflictDoNothing({
          target: [studentAcademics.studentProfileId, studentAcademics.academicYearId],
          where: sql`${studentAcademics.deletedAt} IS NULL`,
        })
        .returning({ id: studentAcademics.id });
      if (!rows[0]) return null;

      return { id: rows[0].id, strength: locked && (await strengthChange(tx, locked)) };
    });
    return result;
  }

  async findPlacement(
    tenantId: string,
    studentAcademicId: string,
  ): Promise<StudentAcademicPlacementRecord | null> {
    const current = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          id: studentAcademicsLive.id,
          sectionId: studentAcademicsLive.sectionId,
          studentProfileId: studentAcademicsLive.studentProfileId,
        })
        .from(studentAcademicsLive)
        .where(eq(studentAcademicsLive.id, studentAcademicId))
        .limit(1);
    });
    return current[0] ?? null;
  }

  setSection(
    tenantId: string,
    studentAcademicId: string,
    sectionId: string,
    actorId: string,
  ): Promise<SectionStrengthChange | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [current] = await tx
        .select({ sectionId: studentAcademicsLive.sectionId })
        .from(studentAcademicsLive)
        .where(eq(studentAcademicsLive.id, studentAcademicId))
        .limit(1);
      const locked = await lockSectionForPlacement(tx, sectionId, [current?.sectionId ?? null]);
      await tx
        .update(studentAcademics)
        .set({ sectionId, updatedBy: actorId })
        .where(eq(studentAcademics.id, studentAcademicId));
      return locked && strengthChange(tx, locked);
    });
  }

  changeClass(
    tenantId: string,
    data: ChangeClassData,
    rules: ClassChangeRules,
  ): Promise<ChangeClassResult> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({
          id: studentAcademicsLive.id,
          studentProfileId: studentAcademicsLive.studentProfileId,
          academicYearId: studentAcademicsLive.academicYearId,
          standardId: studentAcademicsLive.standardId,
          sectionId: studentAcademicsLive.sectionId,
        })
        .from(studentAcademicsLive)
        .where(eq(studentAcademicsLive.id, data.studentAcademicId))
        .limit(1);
      if (!row) return { kind: 'academic_not_found' };

      const placement = await findClassInYear(
        tx,
        row.academicYearId,
        data.standardId,
        data.sectionId,
      );
      if (placement.kind !== 'ok') return placement;

      rules.assertPlacementChanges(row);

      const locked = await lockSectionForPlacement(tx, data.sectionId, [row.sectionId]);
      if (!locked) return { kind: 'section_not_found' };
      rules.assertCapacity(locked);

      await tx
        .update(studentAcademics)
        .set({
          standardId: data.standardId,
          sectionId: data.sectionId,
          updatedBy: data.actorId,
          updatedAt: new Date(),
          version: sql`${studentAcademics.version} + 1`,
        })
        .where(and(eq(studentAcademics.id, row.id), isNull(studentAcademics.deletedAt)));

      await this.alignPreviousYearResult(
        tx,
        row,
        { id: data.standardId, numericOrder: placement.numericOrder },
        data.actorId,
        rules,
      );
      return { kind: 'ok', row, strength: await strengthChange(tx, locked) };
    });
  }

  private async alignPreviousYearResult(
    tx: DrizzleDB,
    row: { studentProfileId: string; academicYearId: string },
    newStandard: { id: string; numericOrder: number },
    actorId: string,
    rules: ClassChangeRules,
  ): Promise<void> {
    const thisYearStart = tx
      .select({ startDate: academicYearsLive.startDate })
      .from(academicYearsLive)
      .where(eq(academicYearsLive.id, row.academicYearId));
    const [previous] = await tx
      .select({
        id: studentAcademicsLive.id,
        promotionStatus: studentAcademicsLive.promotionStatus,
        numericOrder: standardsLive.numericOrder,
      })
      .from(studentAcademicsLive)
      .innerJoin(academicYearsLive, eq(academicYearsLive.id, studentAcademicsLive.academicYearId))
      .innerJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
      .where(
        and(
          eq(studentAcademicsLive.studentProfileId, row.studentProfileId),
          lt(academicYearsLive.startDate, thisYearStart),
        ),
      )
      .orderBy(desc(academicYearsLive.startDate))
      .limit(1);
    if (!previous) return;
    const result = rules.previousYearResult(previous, newStandard);
    if (!result) return;

    await tx
      .update(studentAcademics)
      .set({
        promotionStatus: result.promotionStatus,
        promotedToStandardId: result.promotedToStandardId,
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${studentAcademics.version} + 1`,
      })
      .where(and(eq(studentAcademics.id, previous.id), isNull(studentAcademics.deletedAt)));
  }

  removeFromYear(
    tenantId: string,
    studentAcademicId: string,
    actorId: string,
  ): Promise<RemoveFromYearResult> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({
          id: studentAcademicsLive.id,
          studentProfileId: studentAcademicsLive.studentProfileId,
          academicYearId: studentAcademicsLive.academicYearId,
          sectionId: studentAcademicsLive.sectionId,
          membershipId: studentProfilesLive.membershipId,
        })
        .from(studentAcademicsLive)
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
        )
        .where(eq(studentAcademicsLive.id, studentAcademicId))
        .limit(1);
      if (!row) return { kind: 'not_found' };

      if (await this.hasRecordsInYear(tx, row)) return { kind: 'has_records' };

      const now = new Date();
      await tx
        .update(studentAcademics)
        .set({
          deletedAt: now,
          deletedBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
          version: sql`${studentAcademics.version} + 1`,
        })
        .where(and(eq(studentAcademics.id, row.id), isNull(studentAcademics.deletedAt)));
      return { kind: 'removed', row };
    });
  }

  /** Marks, attendance and assessments point at the membership; report cards at the profile. */
  private async hasRecordsInYear(
    tx: DrizzleDB,
    row: { studentProfileId: string; membershipId: string; academicYearId: string },
  ): Promise<boolean> {
    const yearExams = tx
      .select({ id: examSchedulesLive.id })
      .from(examSchedulesLive)
      .innerJoin(examsLive, eq(examsLive.id, examSchedulesLive.examId))
      .where(eq(examsLive.academicYearId, row.academicYearId));
    const [hit] = await tx
      .select({ id: studentProfilesLive.id })
      .from(studentProfilesLive)
      .where(
        and(
          eq(studentProfilesLive.id, row.studentProfileId),
          or(
            exists(
              tx
                .select({ one: sql`1` })
                .from(attendanceEntriesLive)
                .innerJoin(
                  attendanceSessionsLive,
                  eq(attendanceSessionsLive.id, attendanceEntriesLive.sessionId),
                )
                .where(
                  and(
                    eq(attendanceEntriesLive.studentId, row.membershipId),
                    eq(attendanceSessionsLive.academicYearId, row.academicYearId),
                  ),
                ),
            ),
            exists(
              tx
                .select({ one: sql`1` })
                .from(examMarksLive)
                .where(
                  and(
                    eq(examMarksLive.studentId, row.membershipId),
                    inArray(examMarksLive.examScheduleId, yearExams),
                  ),
                ),
            ),
            exists(
              tx
                .select({ one: sql`1` })
                .from(examTopicAssessmentsLive)
                .where(
                  and(
                    eq(examTopicAssessmentsLive.studentId, row.membershipId),
                    inArray(examTopicAssessmentsLive.examScheduleId, yearExams),
                  ),
                ),
            ),
            exists(
              tx
                .select({ one: sql`1` })
                .from(coScholasticAssessmentsLive)
                .innerJoin(
                  examTermsLive,
                  eq(examTermsLive.id, coScholasticAssessmentsLive.examTermId),
                )
                .where(
                  and(
                    eq(coScholasticAssessmentsLive.studentId, row.membershipId),
                    eq(examTermsLive.academicYearId, row.academicYearId),
                  ),
                ),
            ),
            exists(
              tx
                .select({ one: sql`1` })
                .from(reportCardInstancesLive)
                .where(
                  and(
                    eq(reportCardInstancesLive.studentProfileId, row.studentProfileId),
                    eq(reportCardInstancesLive.academicYearId, row.academicYearId),
                  ),
                ),
            ),
          ),
        ),
      )
      .limit(1);
    return hit !== undefined;
  }

  setPromotionDecisions(
    tenantId: string,
    data: PromotionDecisionData,
    assertAllUpdated: (updated: number) => void,
  ): Promise<number> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const updated = await tx
        .update(studentAcademics)
        .set({
          promotionStatus: data.status,
          ...(data.clearPromotedTo && { promotedToStandardId: null }),
          updatedBy: data.actorId,
          updatedAt: new Date(),
          version: sql`${studentAcademics.version} + 1`,
        })
        .where(and(inArray(studentAcademics.id, data.ids), isNull(studentAcademics.deletedAt)))
        .returning({ id: studentAcademics.id });

      assertAllUpdated(updated.length);
      return updated.length;
    });
  }

  private async readSectionCapacity(
    tx: DrizzleDB,
    sectionId: string,
  ): Promise<SectionCapacityRecord | null> {
    const sectionRows = await tx
      .select({
        currentStrength: sectionsLive.currentStrength,
        capacity: sectionsLive.capacity,
      })
      .from(sectionsLive)
      .where(eq(sectionsLive.id, sectionId))
      .limit(1);

    if (sectionRows.length === 0) return null;

    const configRows = await tx
      .select({ sectionStrengthNorms: instituteConfigsLive.sectionStrengthNorms })
      .from(instituteConfigsLive)
      .limit(1);

    return { section: sectionRows[0], norms: configRows[0]?.sectionStrengthNorms ?? null };
  }
}
