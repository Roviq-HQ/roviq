import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { admissionClassError, assertAdmissionClass } from './admission-class';
/** Student CRUD service (ROV-154). Queries live in StudentRepository and StudentReadRepository. */

import { Injectable, Logger } from '@nestjs/common';
import {
  AcademicStatus,
  AdmissionType,
  type AppAbility,
  BusinessException,
  ErrorCode,
  SocialCategory,
  STUDENT_ACADEMIC_STATE_MACHINE,
  USER_DOCUMENT_TYPE_VALUES,
  UserDocumentType,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { getRequestContext } from '@roviq/request-context';
import { IdentityService } from '../../auth/identity.service';
import type { TenantUserProfileFields } from '../../auth/tenant-user-profile';
import { FileService } from '../../files/file.service';
import type { CreateStudentInput } from './dto/create-student.input';
import type { StudentFilterInput } from './dto/student-filter.input';
import type { UpdateStudentInput } from './dto/update-student.input';
import type { StudentModel } from './models/student.model';
import type { StudentDocumentModel } from './models/student-document.model';
import type { AdmitStudentResult } from './repositories/admit-student';
import { StudentRepository } from './repositories/student.repository';
import type { SectionStrengthChange } from './repositories/types';
import { emitSectionCapacityWarning } from './section-norms';
import { StudentReadRepository } from './student-read.repository';

const DOCUMENT_FILE_PURPOSE = 'USER_DOCUMENT';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly repository: StudentRepository,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
    private readonly readRepository: StudentReadRepository,
    private readonly files: FileService,
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

  // ── CREATE ────────────────────────────────────────────────

  async create(input: CreateStudentInput): Promise<StudentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Before anything is written: a refused admission must leave no user or membership behind,
    // and a foreign key would accept another institute's year or section (ROV-293).
    const admissionClass = {
      academicYearId: input.academicYearId,
      standardId: input.standardId,
      sectionId: input.sectionId,
    };
    assertAdmissionClass(await this.repository.checkAdmissionClass(tenantId, admissionClass));

    // A typed number never identifies an existing account (SF-053): every student is a new user.
    const userId = await this.createUser(input.phone, actorId);
    const name = { firstName: input.firstName, lastName: input.lastName };
    let admitted: AdmitStudentResult;
    try {
      await this.identityService.ensureUserProfile(userId, name, actorId);
      admitted = await this.repository.admit({
        tenantId,
        userId,
        actorId,
        ...admissionClass,
        tenantProfile: {
          ...name,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth,
          bloodGroup: input.bloodGroup,
          religion: input.religion,
          motherTongue: input.motherTongue,
        },
        profile: {
          admissionDate: input.admissionDate ?? new Date().toISOString().split('T')[0],
          admissionClass: input.admissionClass ?? null,
          admissionType: input.admissionType ?? AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: input.socialCategory ?? SocialCategory.GENERAL,
          caste: input.caste ?? null,
          isMinority: input.isMinority ?? false,
          minorityType: input.minorityType ?? null,
          isBpl: input.isBpl ?? false,
          isCwsn: input.isCwsn ?? false,
          cwsnType: input.cwsnType ?? null,
          isRteAdmitted: input.isRteAdmitted ?? false,
          rteCertificate: input.rteCertificate ?? null,
          previousSchoolName: input.previousSchoolName ?? null,
          previousSchoolBoard: input.previousSchoolBoard ?? null,
          previousSchoolUdise: input.previousSchoolUdise ?? null,
          incomingTcNumber: input.incomingTcNumber ?? null,
          incomingTcDate: input.incomingTcDate ?? null,
        },
      });
    } catch (error) {
      await this.discardAccount(userId);
      throw error;
    }
    if (admitted.kind !== 'ok') {
      await this.discardAccount(userId);
      throw admitted.kind === 'role_not_found'
        ? new BusinessException(
            ErrorCode.ROLE_NOT_FOUND,
            'Student role not found for this institute',
          )
        : admissionClassError(admitted);
    }
    const { studentProfileId, membershipId, admissionNumber } = admitted;

    // Emitted only once the institute transaction has committed.
    this.eventBus.emit(EVENT_PATTERNS.STUDENT.admitted, {
      studentProfileId,
      membershipId,
      standardId: input.standardId,
      sectionId: input.sectionId,
      tenantId,
    });
    this.warnIfOptimalReached(tenantId, admitted.strength ? [admitted.strength] : []);

    this.logger.log(`Student created: ${studentProfileId} (admission: ${admissionNumber})`);

    return this.findById(studentProfileId);
  }

  // ── READ ──────────────────────────────────────────────────

  /**
   * Saves a document for a student from files uploaded beforehand. The student must be one
   * the caller can read in this institute; `user_documents` is platform-level and
   * written as admin. Files become READY only together with the document row.
   */
  async uploadDocument(
    input: {
      studentProfileId: string;
      type: UserDocumentType;
      description?: string;
      fileIds: string[];
      referenceNumber?: string;
    },
    ability: AppAbility,
  ): Promise<StudentDocumentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const allowedTypes = new Set<string>(USER_DOCUMENT_TYPE_VALUES);
    if (!allowedTypes.has(input.type)) {
      throw new BusinessException(
        ErrorCode.INVALID_DOCUMENT_TYPE,
        `Invalid document type '${input.type}'`,
      );
    }

    const userId = await this.repository.findReadableUserId(
      tenantId,
      input.studentProfileId,
      ability,
    );
    if (!userId) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    // Same field rule as the document list: a caller who cannot see Aadhaar cannot add one.
    if (input.type === 'AADHAAR_CARD' && !ability.can('read', 'Student', 'aadhaar')) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Not allowed to add this document type');
    }

    await this.files.verifyUploads(input.fileIds, DOCUMENT_FILE_PURPOSE);

    const { document: inserted, files } = await this.repository.createDocument({
      userId,
      actorId,
      type: input.type,
      description: input.description ?? null,
      referenceNumber: input.referenceNumber ?? null,
      fileIds: input.fileIds,
      filePurpose: DOCUMENT_FILE_PURPOSE,
    });

    this.logger.log(
      `Student document uploaded: student=${input.studentProfileId} type=${input.type} actor=${actorId}`,
    );

    return {
      id: inserted.id,
      userId: inserted.userId,
      type: inserted.type,
      description: inserted.description,
      files,
      referenceNumber: inserted.referenceNumber,
      isVerified: inserted.isVerified,
      verifiedAt: inserted.verifiedAt ? inserted.verifiedAt.toISOString() : null,
      verifiedBy: inserted.verifiedBy,
      rejectionReason: inserted.rejectionReason,
      expiryDate: inserted.expiryDate ?? null,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  }

  /**
   * Removes a document of a student of this institute together with its pages and files. Every
   * way the caller cannot reach the document answers STUDENT_NOT_FOUND, so ids cannot be probed.
   */
  async deleteDocument(documentId: string, ability: AppAbility): Promise<boolean> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const type = await this.repository.findReadableDocumentType(tenantId, documentId, ability);
    // Same field rule as the document list: a caller who cannot see Aadhaar cannot remove it.
    const hidden = type === 'AADHAAR_CARD' && !ability.can('read', 'Student', 'aadhaar');
    if (!type || hidden) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Document not found');
    }

    const removed = await this.repository.removeDocument(documentId, actorId);
    if (!removed) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Document not found');
    }

    this.logger.log(`Student document removed: document=${documentId} actor=${actorId}`);
    return true;
  }

  /**
   * AT-003 helper: resolve the joined StudentModel by membership id (the form
   * the attendance domain stores in `attendance_entries.student_id`). Same
   * shape as `findById`, just keyed differently — kept separate so the hot
   * `findById` path stays focused. Returns `null` when the membership maps
   * to a soft-deleted or non-student row.
   */
  async findByMembershipId(membershipId: string): Promise<StudentModel | null> {
    const tenantId = this.getTenantId();
    const studentProfileId = await this.repository.findProfileIdByMembership(
      tenantId,
      membershipId,
    );
    if (!studentProfileId) return null;
    return this.findById(studentProfileId);
  }

  async findById(id: string) {
    return this.readRepository.findForMutation(id, this.getTenantId());
  }

  async list(filter: StudentFilterInput) {
    return this.readRepository.listForAttendance(filter, this.getTenantId());
  }

  async update(id: string, input: UpdateStudentInput): Promise<StudentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const fromStatus = input.academicStatus
      ? await this.validateStatusChange(tenantId, id, input)
      : null;

    // Optimistic concurrency: update student_profile WHERE version = expected
    const profileUpdates = this.buildStudentProfileUpdates(input, actorId);

    const updated = await this.repository.updateProfile(
      tenantId,
      id,
      input.version,
      profileUpdates,
    );

    if (!updated) {
      await this.throwVersionConflict(tenantId, id);
    }
    this.warnIfOptimalReached(tenantId, updated?.strength ?? []);

    // The status write has committed: announce it even if the profile write below fails.
    if (fromStatus && input.academicStatus) {
      this.eventBus.emit(EVENT_PATTERNS.STUDENT.statusChanged, {
        studentProfileId: id,
        fromStatus,
        toStatus: input.academicStatus,
        reason: null,
        tenantId,
      });
    }
    this.emitLeftEventIfApplicable(id, input, tenantId);

    await this.applyUserProfileUpdates(tenantId, id, input, actorId);

    const updatedStudent = await this.findById(id);

    // The GraphQL subscriptions `studentUpdated(studentId)` and
    // `studentsInTenantUpdated` both filter on payload.tenantId. Emit the
    // full student so the filter matches and `@Subscription(() => StudentModel)`
    // can resolve any selected field on the client side.
    const changedFields = Object.entries(input)
      .filter(([field, value]) => field !== 'version' && value !== undefined)
      .map(([field]) => field);
    this.eventBus.emit(EVENT_PATTERNS.STUDENT.updated, {
      ...updatedStudent,
      changedFields,
      tenantId,
    });

    return updatedStudent;
  }

  // ── STATUS TRANSITION ────────────────────────────────────

  /**
   * Explicit status transition for a student (named domain mutation).
   *
   * Unlike `update({ academicStatus })`, this method ONLY changes status —
   * it validates the transition via the state machine, writes the new
   * status + optional reason (stored in tc_reason for departure statuses),
   * and emits `STUDENT.statusChanged`. Destructive transitions
   * (withdrawn / dropped_out / transferred_out) also emit `STUDENT.left`.
   */
  async transitionStatus(
    id: string,
    newStatus: AcademicStatus,
    reason?: string,
  ): Promise<StudentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const current = await this.repository.findStatus(tenantId, id);
    if (!current) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    STUDENT_ACADEMIC_STATE_MACHINE.assertTransition(current.academicStatus, newStatus);
    if (newStatus === AcademicStatus.TRANSFERRED_OUT && !current.tcIssued) {
      throw new BusinessException(
        ErrorCode.TC_REQUIRED_FOR_TRANSFER,
        'Cannot transfer out without issuing a Transfer Certificate',
      );
    }

    const updates: Record<string, unknown> & { academicStatus: AcademicStatus } = {
      academicStatus: newStatus,
      updatedBy: actorId,
    };
    if (reason && StudentService.LEFT_STATUSES.has(newStatus)) {
      updates.tcReason = reason;
    }

    const updated = await this.repository.setStatus(tenantId, id, updates);
    if (!updated) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }
    this.warnIfOptimalReached(tenantId, updated.strength);

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.statusChanged, {
      studentProfileId: id,
      fromStatus: current.academicStatus,
      toStatus: newStatus,
      reason: reason ?? null,
      tenantId,
    });

    if (StudentService.LEFT_STATUSES.has(newStatus)) {
      this.eventBus.emit(EVENT_PATTERNS.STUDENT.left, {
        studentProfileId: id,
        reason: newStatus,
        tcNumber: null,
        tenantId,
      });
    }

    this.logger.log(`Student ${id} status transitioned: ${current.academicStatus} → ${newStatus}`);

    return this.findById(id);
  }

  // ── DELETE ────────────────────────────────────────────────

  async delete(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();

    if (!(await this.repository.exists(tenantId, id))) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    // Check for active enrollments in current year (exclude students who already left)
    const hasActiveEnrollment = await this.repository.hasActiveEnrollment(tenantId, id, [
      ...StudentService.LEFT_STATUSES,
    ]);
    if (hasActiveEnrollment) {
      throw new BusinessException(
        ErrorCode.HAS_ACTIVE_ENROLLMENTS,
        'Cannot delete student with active enrollments in the current academic year',
      );
    }

    await this.repository.softDelete(tenantId, id);

    return true;
  }

  async listDeleted() {
    return this.repository.listDeleted(this.getTenantId());
  }

  async restore(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const result = await this.repository.restore(tenantId, id, actorId);
    if (result.kind === 'not_found') {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Deleted student not found');
    }
    if (result.kind === 'admission_number_taken') {
      throw new BusinessException(
        ErrorCode.ADMISSION_NUMBER_TAKEN,
        `Admission number ${result.admissionNumber} is now used by another student`,
      );
    }

    return true;
  }

  // ── STATISTICS ────────────────────────────────────────────

  // ── PRIVATE HELPERS ───────────────────────────────────────

  private async validateStatusChange(
    tenantId: string,
    id: string,
    input: UpdateStudentInput,
  ): Promise<AcademicStatus> {
    const current = await this.repository.findStatus(tenantId, id);
    if (!current) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    STUDENT_ACADEMIC_STATE_MACHINE.assertTransition(
      current.academicStatus,
      input.academicStatus as AcademicStatus,
    );
    const tcIssued = input.tcIssued ?? current.tcIssued;
    if (input.academicStatus === AcademicStatus.TRANSFERRED_OUT && !tcIssued) {
      throw new BusinessException(
        ErrorCode.TC_REQUIRED_FOR_TRANSFER,
        'Cannot transfer out without issuing a Transfer Certificate',
      );
    }
    return current.academicStatus;
  }

  private buildStudentProfileUpdates(
    input: UpdateStudentInput,
    actorId: string,
  ): Record<string, unknown> {
    const updates: Record<string, unknown> = { updatedBy: actorId };
    const fields = [
      'socialCategory',
      'caste',
      'isMinority',
      'minorityType',
      'isBpl',
      'isCwsn',
      'cwsnType',
      'isRteAdmitted',
      'rteCertificate',
      'academicStatus',
      'tcIssued',
      'tcNumber',
      'tcIssuedDate',
      'tcReason',
      'dateOfLeaving',
    ] as const;
    for (const field of fields) {
      if (input[field] !== undefined) updates[field] = input[field];
    }
    return updates;
  }

  private async throwVersionConflict(tenantId: string, id: string): Promise<never> {
    if (!(await this.repository.exists(tenantId, id))) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }
    throw new BusinessException(
      ErrorCode.CONCURRENT_MODIFICATION,
      'Concurrent modification detected — please reload and try again',
    );
  }

  private async applyUserProfileUpdates(
    tenantId: string,
    id: string,
    input: UpdateStudentInput,
    actorId: string,
  ): Promise<void> {
    const updates: Partial<TenantUserProfileFields> = {
      ...(input.firstName !== undefined && { firstName: input.firstName }),
      ...(input.lastName !== undefined && { lastName: input.lastName }),
      ...(input.gender !== undefined && { gender: input.gender }),
      ...(input.dateOfBirth !== undefined && { dateOfBirth: input.dateOfBirth }),
      ...(input.bloodGroup !== undefined && { bloodGroup: input.bloodGroup }),
      ...(input.religion !== undefined && { religion: input.religion }),
      ...(input.motherTongue !== undefined && { motherTongue: input.motherTongue }),
    };

    if (Object.keys(updates).length === 0) return;

    await this.repository.updateTenantProfile(tenantId, id, actorId, updates);
  }

  private static readonly LEFT_STATUSES = new Set<AcademicStatus>([
    AcademicStatus.TRANSFERRED_OUT,
    AcademicStatus.DROPPED_OUT,
    AcademicStatus.WITHDRAWN,
    AcademicStatus.EXPELLED,
  ]);

  private emitLeftEventIfApplicable(id: string, input: UpdateStudentInput, tenantId: string): void {
    if (input.academicStatus && StudentService.LEFT_STATUSES.has(input.academicStatus)) {
      this.eventBus.emit(EVENT_PATTERNS.STUDENT.left, {
        studentProfileId: id,
        reason: input.academicStatus,
        tcNumber: input.tcNumber ?? null,
        tenantId,
      });
    }
  }

  /** A failed admission must not leave the account it made behind (ROV-275). */
  private async discardAccount(userId: string): Promise<void> {
    try {
      if (!(await this.identityService.discardNewUser(userId))) {
        this.logger.warn(`Kept account ${userId} of a failed admission: it is in use`);
      }
    } catch (error) {
      // The admission's own error is the one the caller must see.
      this.logger.error(`Could not remove account ${userId} of a failed admission`, error);
    }
  }

  private async createUser(phone: string | undefined, actorId: string): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 12);
    const { userId } = await this.identityService.createUser({
      email: `student-${suffix}@roviq.placeholder`,
      username: `student-${suffix}`,
      // Unverified contact data: it may repeat across users and never links accounts.
      phone: phone ? { countryCode: '+91', number: phone } : undefined,
      actorId,
    });
    return userId;
  }

  /** Sent after the write committed; the crossing itself was decided under the section locks. */
  private warnIfOptimalReached(tenantId: string, strength: SectionStrengthChange[]): void {
    for (const change of strength) {
      emitSectionCapacityWarning(
        (pattern, payload) => this.eventBus.emit(pattern, payload),
        tenantId,
        change,
      );
    }
  }
}
