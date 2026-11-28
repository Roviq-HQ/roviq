import { BusinessException, ErrorCode, PromotionStatus } from '@roviq/common-types';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
/**
 * Student enrollment + section change service (ROV-154).
 *
 * Handles capacity checks (warn at optimal, hard-block at hard_max),
 * section strength updates, and NATS event emission.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBusService } from '@roviq/event-bus';
import { getRequestContext } from '@roviq/request-context';
import type { ChangeStudentClassInput } from './dto/change-student-class.input';
import type { EnrollStudentInput, UpdateStudentSectionInput } from './dto/enroll-student.input';
import type { SetPromotionDecisionsInput } from './dto/set-promotion-decisions.input';
import { StudentAcademicRepository } from './repositories/student-academic.repository';
import type {
  ClassLookupFailure,
  PreviousYearResultRecord,
  PreviousYearResultUpdate,
  SectionCapacityRecord,
  SectionStrengthChange,
  SectionStrengthNorms,
} from './repositories/types';
import { DEFAULT_SECTION_NORMS, emitSectionCapacityWarning } from './section-norms';

@Injectable()
export class StudentAcademicService {
  private readonly logger = new Logger(StudentAcademicService.name);

  constructor(
    private readonly repository: StudentAcademicRepository,
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
    return this.repository.listHistory(this.getTenantId(), studentProfileId);
  }

  // ── ENROLL ────────────────────────────────────────────────

  async enroll(input: EnrollStudentInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const target = await this.repository.checkEnrolTarget(tenantId, input);
    if (target.kind === 'student_not_found') {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }
    if (target.kind === 'year_not_found') {
      throw new BusinessException(ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found');
    }
    if (target.kind !== 'ok') this.throwClassLookupFailure(target);

    // Get section and capacity norms
    const { section, norms } = await this.getSectionWithNorms(tenantId, input.sectionId);

    // Capacity check
    this.checkCapacity(section.currentStrength, norms, input.overrideReason);

    // Create student_academics row
    const result = await this.repository.createPlacement(tenantId, {
      studentProfileId: input.studentProfileId,
      academicYearId: input.academicYearId,
      standardId: input.standardId,
      sectionId: input.sectionId,
      actorId,
    });
    if (!result) {
      throw new BusinessException(
        ErrorCode.STUDENT_ALREADY_ENROLLED,
        'Student is already enrolled in this academic year',
      );
    }

    this.warnIfOptimalReached(tenantId, result.strength);

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.enrolled, {
      studentProfileId: input.studentProfileId,
      academicYearId: input.academicYearId,
      sectionId: input.sectionId,
      tenantId,
    });

    this.logger.log(`Student ${input.studentProfileId} enrolled in section ${input.sectionId}`);
    return { id: result.id };
  }

  // ── SECTION CHANGE ────────────────────────────────────────

  async changeSection(input: UpdateStudentSectionInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Get current enrollment
    const current = await this.repository.findPlacement(tenantId, input.studentAcademicId);
    if (!current) {
      throw new BusinessException(
        ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
        'Student academic record not found',
      );
    }

    const oldSectionId = current.sectionId;

    // Capacity check on target section
    const { section: targetSection, norms } = await this.getSectionWithNorms(
      tenantId,
      input.newSectionId,
    );
    this.checkCapacity(targetSection.currentStrength, norms, input.overrideReason);

    // The trigger adjusts both sections' strengths.
    const strength = await this.repository.setSection(
      tenantId,
      input.studentAcademicId,
      input.newSectionId,
      actorId,
    );
    this.warnIfOptimalReached(tenantId, strength);

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.section_changed, {
      studentProfileId: current.studentProfileId,
      oldSectionId,
      newSectionId: input.newSectionId,
      tenantId,
    });

    this.logger.log(
      `Student section changed: ${current.studentProfileId} from ${oldSectionId} to ${input.newSectionId}`,
    );

    return { id: current.id };
  }

  // ── CLASS CHANGE (ROV-322) ────────────────────────────────

  /**
   * Moves a student to another class of the same year and rewrites last year's result to match,
   * all in one transaction.
   */
  async changeClass(input: ChangeStudentClassInput): Promise<{ id: string }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const result = await this.repository.changeClass(
      tenantId,
      {
        studentAcademicId: input.studentAcademicId,
        standardId: input.standardId,
        sectionId: input.sectionId,
        actorId,
      },
      {
        assertPlacementChanges: (row) => {
          if (row.standardId === input.standardId && row.sectionId === input.sectionId) {
            throw new BusinessException(
              ErrorCode.VALIDATION_FAILED,
              'The student is already in this class and section',
            );
          }
        },
        assertCapacity: (capacity) => {
          const { section, norms } = this.withDefaultNorms(capacity);
          this.checkCapacity(section.currentStrength, norms, input.overrideReason);
        },
        previousYearResult: (previous, newStandard) =>
          this.alignedPreviousYearResult(previous, newStandard),
      },
    );
    if (result.kind === 'academic_not_found') {
      throw new BusinessException(
        ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
        'Student academic record not found',
      );
    }
    if (result.kind !== 'ok') this.throwClassLookupFailure(result);
    const moved = result.row;

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
    this.warnIfOptimalReached(tenantId, result.strength);

    this.logger.log(
      `Student class changed: ${moved.studentProfileId} to standard ${input.standardId}, section ${input.sectionId}`,
    );
    return { id: moved.id };
  }

  /** Last year's result must agree with where the student now sits; TRANSFERRED is the TC flow's. */
  private alignedPreviousYearResult(
    previous: PreviousYearResultRecord,
    newStandard: { id: string; numericOrder: number },
  ): PreviousYearResultUpdate | null {
    if (previous.promotionStatus === PromotionStatus.TRANSFERRED) return null;
    if (newStandard.numericOrder < previous.numericOrder) return null;

    const promoted = newStandard.numericOrder > previous.numericOrder;
    return {
      promotionStatus: promoted ? PromotionStatus.PROMOTED : PromotionStatus.DETAINED,
      promotedToStandardId: promoted ? newStandard.id : null,
    };
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

    const result = await this.repository.removeFromYear(tenantId, studentAcademicId, actorId);
    if (result.kind === 'not_found') {
      throw new BusinessException(
        ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
        'Student academic record not found',
      );
    }
    if (result.kind === 'has_records') {
      throw new BusinessException(
        ErrorCode.STUDENT_YEAR_HAS_RECORDS,
        'The student has attendance, marks, assessments or report cards in this year',
      );
    }
    const removed = result.row;

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

  // ── YEAR-END RESULT ───────────────────────────────────────

  /** All-or-nothing: one unknown id writes nothing. The rollover reads the result later. */
  async setPromotionDecisions(input: SetPromotionDecisionsInput): Promise<number> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const ids = [...new Set(input.studentAcademicIds)];

    return this.repository.setPromotionDecisions(
      tenantId,
      {
        ids,
        status: input.status,
        clearPromotedTo: input.status !== PromotionStatus.PROMOTED,
        actorId,
      },
      (updated) => {
        if (updated !== ids.length) {
          throw new BusinessException(
            ErrorCode.STUDENT_ACADEMIC_NOT_FOUND,
            'Student academic record not found',
          );
        }
      },
    );
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────

  private throwClassLookupFailure(failure: ClassLookupFailure): never {
    if (failure.kind === 'standard_not_found') {
      throw new BusinessException(
        ErrorCode.STANDARD_NOT_FOUND,
        'Standard not found in this academic year',
      );
    }
    throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
  }

  /** Called after the placement's transaction committed, with the counts it read under the lock. */
  private warnIfOptimalReached(tenantId: string, strength: SectionStrengthChange | null): void {
    emitSectionCapacityWarning(
      (pattern, payload) => this.eventBus.emit(pattern, payload),
      tenantId,
      strength,
    );
  }

  private async getSectionWithNorms(
    tenantId: string,
    sectionId: string,
  ): Promise<{
    section: SectionCapacityRecord['section'];
    norms: SectionStrengthNorms;
  }> {
    const capacity = await this.repository.findSectionCapacity(tenantId, sectionId);
    if (!capacity) {
      throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
    }
    return this.withDefaultNorms(capacity);
  }

  private withDefaultNorms(capacity: SectionCapacityRecord): {
    section: SectionCapacityRecord['section'];
    norms: SectionStrengthNorms;
  } {
    return { section: capacity.section, norms: capacity.norms ?? DEFAULT_SECTION_NORMS };
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
      this.logger.warn(`Capacity override: ${currentStrength}/${norms.hardMax}`);
    }
  }
}
