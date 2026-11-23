import { BusinessException, ErrorCode, PromotionStatus } from '@roviq/common-types';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
/**
 * Student enrollment + section change service (ROV-154).
 *
 * Handles capacity checks (warn at optimal, hard-block at hard_max),
 * section strength updates, and NATS event emission.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
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
  type SectionStrengthNorms,
  sectionsLive,
  standardsLive,
  studentAcademics,
  studentAcademicsLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { getRequestContext } from '@roviq/request-context';
import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ChangeStudentClassInput } from './dto/change-student-class.input';
import type { EnrollStudentInput, UpdateStudentSectionInput } from './dto/enroll-student.input';
import type { SetPromotionDecisionsInput } from './dto/set-promotion-decisions.input';

@Injectable()
export class StudentAcademicService {
  private readonly logger = new Logger(StudentAcademicService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly eventBus: EventBusService,
  ) {}

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  private getUserId(): string {
    const { userId } = getRequestContext();
    if (!userId) throw new Error('User context is required');
    return userId;
  }

  // ── LIST HISTORY (ROV-167 detail page) ───────────────────────

  /**
   * Returns the year-by-year academic history for a single student, joined
   * to academic year + standard + section labels. Used by the Academics tab
   * on the student detail page. Sorted newest year first.
   *
   * `isCurrentYear` is computed against the institute's currently-active
   * academic year (academic_years.is_active = true) so the frontend can
   * highlight the current row.
   */
  async listForStudent(studentProfileId: string) {
    const tenantId = this.getTenantId();

    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:student-academic'), async (tx) => {
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

  // ── ENROLL ────────────────────────────────────────────────

  async enroll(input: EnrollStudentInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student-academic'), (tx) =>
      this.assertEnrolTarget(tx, input),
    );

    // Get section and capacity norms
    const { section, norms } = await this.getSectionWithNorms(tenantId, input.sectionId);

    // Capacity check
    this.checkCapacity(section.currentStrength, norms, input.overrideReason);

    // Create student_academics row
    const result = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student-academic'),
      async (tx) => {
        const rows = await tx
          .insert(studentAcademics)
          .values({
            studentProfileId: input.studentProfileId,
            academicYearId: input.academicYearId,
            standardId: input.standardId,
            sectionId: input.sectionId,
            tenantId,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .onConflictDoNothing({
            target: [studentAcademics.studentProfileId, studentAcademics.academicYearId],
            where: sql`${studentAcademics.deletedAt} IS NULL`,
          })
          .returning({ id: studentAcademics.id });

        return rows[0];
      },
    );
    if (!result) {
      throw new BusinessException(
        ErrorCode.STUDENT_ALREADY_ENROLLED,
        'Student is already enrolled in this academic year',
      );
    }

    // Emit warning if at optimal capacity
    if (section.currentStrength + 1 >= norms.optimal) {
      this.eventBus.emit(EVENT_PATTERNS.SECTION.capacity_warning, {
        sectionId: input.sectionId,
        currentStrength: section.currentStrength + 1,
        optimal: norms.optimal,
        tenantId,
      });
    }

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.enrolled, {
      studentProfileId: input.studentProfileId,
      academicYearId: input.academicYearId,
      sectionId: input.sectionId,
      tenantId,
    });

    this.logger.log(`Student ${input.studentProfileId} enrolled in section ${input.sectionId}`);
    return result;
  }

  // ── SECTION CHANGE ────────────────────────────────────────

  async changeSection(input: UpdateStudentSectionInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Get current enrollment
    const current = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student-academic'),
      async (tx) => {
        return tx
          .select({
            id: studentAcademicsLive.id,
            sectionId: studentAcademicsLive.sectionId,
            studentProfileId: studentAcademicsLive.studentProfileId,
          })
          .from(studentAcademicsLive)
          .where(eq(studentAcademicsLive.id, input.studentAcademicId))
          .limit(1);
      },
    );

    if (current.length === 0) {
      throw new BusinessException(
        ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
        'Student academic record not found',
      );
    }

    const oldSectionId = current[0].sectionId;

    // Capacity check on target section
    const { section: targetSection, norms } = await this.getSectionWithNorms(
      tenantId,
      input.newSectionId,
    );
    this.checkCapacity(targetSection.currentStrength, norms, input.overrideReason);

    // Update section + adjust strengths
    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student-academic'), async (tx) => {
      await tx
        .update(studentAcademics)
        .set({ sectionId: input.newSectionId, updatedBy: actorId })
        .where(eq(studentAcademics.id, input.studentAcademicId));
    });

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.section_changed, {
      studentProfileId: current[0].studentProfileId,
      oldSectionId,
      newSectionId: input.newSectionId,
      tenantId,
    });

    this.logger.log(
      `Student section changed: ${current[0].studentProfileId} from ${oldSectionId} to ${input.newSectionId}`,
    );

    return { id: current[0].id };
  }

  // ── CLASS CHANGE (ROV-322) ────────────────────────────────

  /**
   * Moves a student to another class of the same year and rewrites last year's result to match,
   * all in one transaction.
   */
  async changeClass(input: ChangeStudentClassInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const moved = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student-academic'),
      async (tx) => {
        const [row] = await tx
          .select({
            id: studentAcademicsLive.id,
            studentProfileId: studentAcademicsLive.studentProfileId,
            academicYearId: studentAcademicsLive.academicYearId,
            standardId: studentAcademicsLive.standardId,
            sectionId: studentAcademicsLive.sectionId,
          })
          .from(studentAcademicsLive)
          .where(eq(studentAcademicsLive.id, input.studentAcademicId))
          .limit(1);
        if (!row) {
          throw new BusinessException(
            ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
            'Student academic record not found',
          );
        }

        const standard = await this.assertClassInYear(
          tx,
          row.academicYearId,
          input.standardId,
          input.sectionId,
        );

        if (row.standardId === input.standardId && row.sectionId === input.sectionId) {
          throw new BusinessException(
            ErrorCode.VALIDATION_FAILED,
            'The student is already in this class and section',
          );
        }

        const { section: target, norms } = await this.readSectionWithNorms(tx, input.sectionId);
        this.checkCapacity(target.currentStrength, norms, input.overrideReason);

        await tx
          .update(studentAcademics)
          .set({
            standardId: input.standardId,
            sectionId: input.sectionId,
            updatedBy: actorId,
            updatedAt: new Date(),
            version: sql`${studentAcademics.version} + 1`,
          })
          .where(and(eq(studentAcademics.id, row.id), isNull(studentAcademics.deletedAt)));

        await this.alignPreviousYearResult(
          tx,
          row,
          { id: input.standardId, numericOrder: standard.numericOrder },
          actorId,
        );
        return row;
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.section_changed, {
      studentProfileId: moved.studentProfileId,
      oldSectionId: moved.sectionId,
      newSectionId: input.sectionId,
      tenantId,
    });
    this.eventBus.emit(EVENT_PATTERNS.STUDENT.promoted, {
      studentProfileId: moved.studentProfileId,
      tenantId,
    });

    this.logger.log(
      `Student class changed: ${moved.studentProfileId} to standard ${input.standardId}, section ${input.sectionId}`,
    );
    return { id: moved.id };
  }

  /** Last year's result must agree with where the student now sits; TRANSFERRED is the TC flow's. */
  private async alignPreviousYearResult(
    tx: DrizzleDB,
    row: { studentProfileId: string; academicYearId: string },
    newStandard: { id: string; numericOrder: number },
    actorId: string,
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
    if (!previous || previous.promotionStatus === PromotionStatus.TRANSFERRED) return;
    if (newStandard.numericOrder < previous.numericOrder) return;

    const promoted = newStandard.numericOrder > previous.numericOrder;
    await tx
      .update(studentAcademics)
      .set({
        promotionStatus: promoted ? PromotionStatus.PROMOTED : PromotionStatus.DETAINED,
        promotedToStandardId: promoted ? newStandard.id : null,
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${studentAcademics.version} + 1`,
      })
      .where(and(eq(studentAcademics.id, previous.id), isNull(studentAcademics.deletedAt)));
  }

  // ── REMOVE FROM YEAR (ROV-322) ────────────────────────────

  /** Soft-deletes the year record; refused once the year holds any of the student's records. */
  async removeFromYear(studentAcademicId: string, rawReason: string): Promise<void> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const reason = rawReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Reason must be 3 to 500 characters',
      );
    }

    const removed = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student-academic'),
      async (tx) => {
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
        if (!row) {
          throw new BusinessException(
            ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
            'Student academic record not found',
          );
        }

        if (await this.hasRecordsInYear(tx, row)) {
          throw new BusinessException(
            ErrorCode.STUDENT_YEAR_HAS_RECORDS,
            'The student has attendance, marks, assessments or report cards in this year',
          );
        }

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
        return row;
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.removed_from_year, {
      studentProfileId: removed.studentProfileId,
      academicYearId: removed.academicYearId,
      sectionId: removed.sectionId,
      reason,
      tenantId,
    });
    this.logger.log(
      `Student ${removed.studentProfileId} removed from year ${removed.academicYearId}`,
    );
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

  // ── YEAR-END RESULT ───────────────────────────────────────

  /** All-or-nothing: one unknown id writes nothing. The rollover reads the result later. */
  async setPromotionDecisions(input: SetPromotionDecisionsInput): Promise<number> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const ids = [...new Set(input.studentAcademicIds)];

    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:student-academic'), async (tx) => {
      const updated = await tx
        .update(studentAcademics)
        .set({
          promotionStatus: input.status,
          ...(input.status !== PromotionStatus.PROMOTED && { promotedToStandardId: null }),
          updatedBy: actorId,
          updatedAt: new Date(),
          version: sql`${studentAcademics.version} + 1`,
        })
        .where(and(inArray(studentAcademics.id, ids), isNull(studentAcademics.deletedAt)))
        .returning({ id: studentAcademics.id });

      if (updated.length !== ids.length) {
        throw new BusinessException(
          ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
          'Student academic record not found',
        );
      }
      return updated.length;
    });
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────

  /** RLS hides other institutes' rows, so a foreign id fails here as not found. */
  private async assertClassInYear(
    tx: DrizzleDB,
    academicYearId: string,
    standardId: string,
    sectionId: string,
  ): Promise<{ numericOrder: number }> {
    const [standard] = await tx
      .select({ numericOrder: standardsLive.numericOrder })
      .from(standardsLive)
      .where(
        and(eq(standardsLive.id, standardId), eq(standardsLive.academicYearId, academicYearId)),
      )
      .limit(1);
    if (!standard) {
      throw new BusinessException(
        ErrorCode.STANDARD_NOT_FOUND,
        'Standard not found in this academic year',
      );
    }

    const [section] = await tx
      .select({ id: sectionsLive.id })
      .from(sectionsLive)
      .where(and(eq(sectionsLive.id, sectionId), eq(sectionsLive.standardId, standardId)))
      .limit(1);
    if (!section) {
      throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
    }
    return standard;
  }

  /** Foreign keys do not apply RLS: without this, another institute's student or year id is accepted. */
  private async assertEnrolTarget(tx: DrizzleDB, input: EnrollStudentInput): Promise<void> {
    const [student] = await tx
      .select({ id: studentProfilesLive.id })
      .from(studentProfilesLive)
      .where(eq(studentProfilesLive.id, input.studentProfileId))
      .limit(1);
    if (!student) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    const [year] = await tx
      .select({ id: academicYearsLive.id })
      .from(academicYearsLive)
      .where(eq(academicYearsLive.id, input.academicYearId))
      .limit(1);
    if (!year) {
      throw new BusinessException(ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found');
    }

    await this.assertClassInYear(tx, input.academicYearId, input.standardId, input.sectionId);
  }

  private getSectionWithNorms(tenantId: string, sectionId: string) {
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:student-academic'), (tx) =>
      this.readSectionWithNorms(tx, sectionId),
    );
  }

  private async readSectionWithNorms(
    tx: DrizzleDB,
    sectionId: string,
  ): Promise<{
    section: { currentStrength: number; capacity: number | null };
    norms: SectionStrengthNorms;
  }> {
    const sectionRows = await tx
      .select({
        currentStrength: sectionsLive.currentStrength,
        capacity: sectionsLive.capacity,
      })
      .from(sectionsLive)
      .where(eq(sectionsLive.id, sectionId))
      .limit(1);

    if (sectionRows.length === 0) {
      throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
    }

    const configRows = await tx
      .select({ sectionStrengthNorms: instituteConfigsLive.sectionStrengthNorms })
      .from(instituteConfigsLive)
      .limit(1);

    const norms: SectionStrengthNorms = configRows[0]?.sectionStrengthNorms ?? {
      optimal: 40,
      hardMax: 45,
      exemptionAllowed: true,
    };

    return { section: sectionRows[0], norms };
  }

  private checkCapacity(
    currentStrength: number,
    norms: SectionStrengthNorms,
    overrideReason?: string,
  ): void {
    if (currentStrength >= norms.hardMax) {
      if (!overrideReason) {
        throw new BusinessException(
          ErrorCode.SECTION_CAPACITY_EXCEEDED,
          `Section at hard maximum capacity (${currentStrength}/${norms.hardMax}). Provide override_reason to proceed.`,
        );
      }
      this.logger.warn(
        `Capacity override: ${currentStrength}/${norms.hardMax}. Reason: ${overrideReason}`,
      );
    }
  }
}
