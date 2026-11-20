import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
/**
 * Student CRUD service (ROV-154).
 *
 * Direct service → Drizzle (no abstract repository).
 * Auth/user creation uses direct DB stubs (same pattern as bulk import).
 * TODO: Replace user creation with NATS calls when Identity Service is ready.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  phoneNumbersLive,
  rolesLive,
  sections,
  softDelete,
  studentAcademics,
  studentAcademicsLive,
  studentProfiles,
  studentProfilesLive,
  userDocuments,
  userDocumentsLive,
  userProfiles,
  userProfilesLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { getRequestContext } from '@roviq/request-context';
import { and, desc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { IdentityService } from '../../auth/identity.service';
import { FileService } from '../../files/file.service';
import { markFilesReady } from '../../files/file-attachment';
import {
  attachUserDocumentFiles,
  loadUserDocumentFiles,
  removeUserDocument,
} from '../../files/user-document-files';
import { nextAdmissionNumber } from './admission-number.sequence';
import type { CreateStudentInput } from './dto/create-student.input';
import type { StudentFilterInput } from './dto/student-filter.input';
import type { UpdateStudentInput } from './dto/update-student.input';
import type { StudentModel } from './models/student.model';
import type { StudentDocumentModel } from './models/student-document.model';
import { StudentReadRepository } from './student-read.repository';
import { studentReadPredicate } from './student-read-predicate';

const DOCUMENT_FILE_PURPOSE = 'USER_DOCUMENT';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
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

    // 1. Find or create user (NATS stub — direct DB)
    let userId: string;
    const phone = input.phone;
    if (phone) {
      const existing = await withAdmin(this.db, mkAdminCtx('service:student'), async (tx) => {
        return tx
          .select({ userId: phoneNumbersLive.userId })
          .from(phoneNumbersLive)
          .where(and(eq(phoneNumbersLive.countryCode, '+91'), eq(phoneNumbersLive.number, phone)))
          .limit(1);
      });
      if (existing.length > 0) {
        userId = existing[0].userId;
      } else {
        userId = await this.createUser(input, actorId);
      }
    } else {
      userId = await this.createUser(input, actorId);
    }

    // 2. Create user_profile (idempotent)
    await withAdmin(this.db, mkAdminCtx('service:student'), async (tx) => {
      await tx
        .insert(userProfiles)
        .values({
          userId,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          gender: input.gender ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          bloodGroup: input.bloodGroup ?? null,
          religion: input.religion ?? null,
          motherTongue: input.motherTongue ?? null,
          nationality: 'Indian',
          createdBy: actorId,
          updatedBy: actorId,
        })
        .onConflictDoNothing();
    });

    // 3. Find student role + create membership
    const studentRole = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ id: rolesLive.id })
          .from(rolesLive)
          .where(
            and(
              eq(rolesLive.tenantId, tenantId),
              sql`${rolesLive.name}->>'en' = 'student' OR ${rolesLive.name}->>'en' = 'Student'`,
            ),
          )
          .limit(1);
      },
    );

    if (studentRole.length === 0) {
      throw new BusinessException(
        ErrorCode.ROLE_NOT_FOUND,
        'Student role not found for this institute',
      );
    }

    const newMemberships = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .insert(memberships)
          .values({
            userId,
            tenantId,
            roleId: studentRole[0].id,
            status: 'ACTIVE',
            abilities: [],
            createdBy: actorId,
            updatedBy: actorId,
          })
          .onConflictDoNothing()
          .returning({ id: memberships.id });
      },
    );

    // If membership already exists, find it
    let membershipId: string;
    if (newMemberships.length > 0) {
      membershipId = newMemberships[0].id;
    } else {
      const existing = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:student'),
        async (tx) => {
          return tx
            .select({ id: membershipsLive.id })
            .from(membershipsLive)
            .where(
              and(
                eq(membershipsLive.userId, userId),
                eq(membershipsLive.tenantId, tenantId),
                eq(membershipsLive.roleId, studentRole[0].id),
              ),
            )
            .limit(1);
        },
      );
      membershipId = existing[0].id;
    }

    // 4–5. Admission number + student_profile in one transaction (no gaps on failure)
    const admissionDate = input.admissionDate ?? new Date().toISOString().split('T')[0];
    const { newProfiles, admissionNumber } = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        const admissionNumber = await nextAdmissionNumber(tx, tenantId, input.standardId);
        const newProfiles = await tx
          .insert(studentProfiles)
          .values({
            userId,
            membershipId,
            tenantId,
            admissionNumber,
            admissionDate,
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
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning({ id: studentProfiles.id });
        return { newProfiles, admissionNumber };
      },
    );

    const studentProfileId = newProfiles[0].id;

    // 6. Create student_academics (initial enrollment)
    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      await tx.insert(studentAcademics).values({
        studentProfileId,
        academicYearId: input.academicYearId,
        standardId: input.standardId,
        sectionId: input.sectionId,
        tenantId,
        createdBy: actorId,
        updatedBy: actorId,
      });

      // Increment section strength
      await tx
        .update(sections)
        .set({ currentStrength: sql`${sections.currentStrength} + 1` })
        .where(eq(sections.id, input.sectionId));
    });

    // 7. Emit event
    this.eventBus.emit(EVENT_PATTERNS.STUDENT.admitted, {
      studentProfileId,
      membershipId,
      standardId: input.standardId,
      sectionId: input.sectionId,
      tenantId,
    });

    this.logger.log(`Student created: ${studentProfileId} (admission: ${admissionNumber})`);

    return this.findById(studentProfileId);
  }

  // ── READ ──────────────────────────────────────────────────

  /**
   * Saves a document for a student from files uploaded beforehand. The student must belong
   * to this institute (RLS on `student_profiles`); `user_documents` is platform-level and
   * written as admin. Files become READY only together with the document row.
   */
  async uploadDocument(input: {
    studentProfileId: string;
    type: UserDocumentType;
    description?: string;
    fileIds: string[];
    referenceNumber?: string;
  }): Promise<StudentDocumentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const allowedTypes = new Set<string>(USER_DOCUMENT_TYPE_VALUES);
    if (!allowedTypes.has(input.type)) {
      throw new BusinessException(
        ErrorCode.INVALID_DOCUMENT_TYPE,
        `Invalid document type '${input.type}'`,
      );
    }

    const studentRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ userId: studentProfilesLive.userId })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.id, input.studentProfileId))
          .limit(1);
      },
    );
    if (studentRows.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }
    const userId = studentRows[0].userId;

    await this.files.verifyUploads(input.fileIds, DOCUMENT_FILE_PURPOSE);

    const { inserted, files } = await withAdmin(
      this.db,
      mkAdminCtx('service:student'),
      async (tx) => {
        // The files must have been uploaded for this very student.
        await markFilesReady(tx, {
          fileIds: input.fileIds,
          purpose: DOCUMENT_FILE_PURPOSE,
          userId: actorId,
          subjectUserId: userId,
        });
        const rows = await tx
          .insert(userDocuments)
          .values({
            createdBy: actorId,
            updatedBy: actorId,
            userId,
            type: input.type,
            description: input.description ?? null,
            referenceNumber: input.referenceNumber ?? null,
          })
          .returning();
        const document = rows[0];
        await attachUserDocumentFiles(tx, {
          documentId: document.id,
          userId,
          fileIds: input.fileIds,
          actorId,
        });
        const attached = await loadUserDocumentFiles(tx, [document.id]);
        return { inserted: document, files: attached.get(document.id) ?? [] };
      },
    );

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

    const documents = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ type: userDocumentsLive.type })
          .from(userDocumentsLive)
          .innerJoin(studentProfilesLive, eq(studentProfilesLive.userId, userDocumentsLive.userId))
          .where(and(eq(userDocumentsLive.id, documentId), studentReadPredicate(ability, null)))
          .limit(1);
      },
    );
    const document = documents[0];
    // Same field rule as the document list: a caller who cannot see Aadhaar cannot remove it.
    const hidden = document?.type === 'AADHAAR_CARD' && !ability.can('read', 'Student', 'aadhaar');
    if (!document || hidden) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Document not found');
    }

    const removed = await withAdmin(this.db, mkAdminCtx('service:student'), (tx) =>
      removeUserDocument(tx, { documentId, actorId }),
    );
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
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ id: studentProfilesLive.id })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.membershipId, membershipId))
          .limit(1);
      },
    );
    if (rows.length === 0) return null;
    return this.findById(rows[0].id);
  }

  async findById(id: string) {
    return this.readRepository.findForMutation(
      id,
      mkInstituteCtx(this.getTenantId(), 'service:student'),
    );
  }

  async list(filter: StudentFilterInput) {
    return this.readRepository.listForAttendance(
      filter,
      mkInstituteCtx(this.getTenantId(), 'service:student'),
    );
  }

  async update(id: string, input: UpdateStudentInput): Promise<StudentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Validate status transition if changing
    if (input.academicStatus) {
      await this.validateStatusChange(tenantId, id, input);
    }

    // Optimistic concurrency: update student_profile WHERE version = expected
    const profileUpdates = this.buildStudentProfileUpdates(input, actorId);

    const updated = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .update(studentProfiles)
          .set({
            ...profileUpdates,
            version: sql`${studentProfiles.version} + 1`,
          })
          .where(
            and(
              eq(studentProfiles.id, id),
              eq(studentProfiles.version, input.version),
              isNull(studentProfiles.deletedAt),
            ),
          )
          .returning({ id: studentProfiles.id });
      },
    );

    if (updated.length === 0) {
      await this.throwVersionConflict(tenantId, id);
    }

    // Update user_profile fields if any provided
    await this.applyUserProfileUpdates(tenantId, id, input, actorId);

    // Emit student.left event for departure statuses
    this.emitLeftEventIfApplicable(id, input, tenantId);

    const updatedStudent = await this.findById(id);

    // The GraphQL subscriptions `studentUpdated(studentId)` and
    // `studentsInTenantUpdated` both filter on payload.tenantId. Emit the
    // full student so the filter matches and `@Subscription(() => StudentModel)`
    // can resolve any selected field on the client side.
    this.eventBus.emit(EVENT_PATTERNS.STUDENT.updated, { ...updatedStudent, tenantId });

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

    const current = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({
            academicStatus: studentProfilesLive.academicStatus,
            tcIssued: studentProfilesLive.tcIssued,
            version: studentProfilesLive.version,
          })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.id, id))
          .limit(1);
      },
    );

    if (current.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    STUDENT_ACADEMIC_STATE_MACHINE.assertTransition(current[0].academicStatus, newStatus);
    if (newStatus === AcademicStatus.TRANSFERRED_OUT && !current[0].tcIssued) {
      throw new BusinessException(
        ErrorCode.TC_REQUIRED_FOR_TRANSFER,
        'Cannot transfer out without issuing a Transfer Certificate',
      );
    }

    const updates: Record<string, unknown> = {
      academicStatus: newStatus,
      updatedBy: actorId,
    };
    if (reason && StudentService.LEFT_STATUSES.has(newStatus)) {
      updates.tcReason = reason;
    }

    const updated = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .update(studentProfiles)
          .set({ ...updates, version: sql`${studentProfiles.version} + 1` })
          .where(and(eq(studentProfiles.id, id), isNull(studentProfiles.deletedAt)))
          .returning({ id: studentProfiles.id });
      },
    );

    if (updated.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    this.eventBus.emit(EVENT_PATTERNS.STUDENT.statusChanged, {
      studentProfileId: id,
      fromStatus: current[0].academicStatus,
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

    this.logger.log(
      `Student ${id} status transitioned: ${current[0].academicStatus} → ${newStatus}`,
    );

    return this.findById(id);
  }

  // ── DELETE ────────────────────────────────────────────────

  async delete(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();

    // Check for active enrollments in current year (exclude students who already left)
    const activeEnrollments = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ id: studentAcademicsLive.id })
          .from(studentAcademicsLive)
          .innerJoin(
            academicYearsLive,
            eq(academicYearsLive.id, studentAcademicsLive.academicYearId),
          )
          .innerJoin(
            studentProfilesLive,
            eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
          )
          .where(
            and(
              eq(studentAcademicsLive.studentProfileId, id),
              eq(academicYearsLive.isActive, true),
              notInArray(studentProfilesLive.academicStatus, [...StudentService.LEFT_STATUSES]),
            ),
          )
          .limit(1);
      },
    );

    if (activeEnrollments.length > 0) {
      throw new BusinessException(
        ErrorCode.HAS_ACTIVE_ENROLLMENTS,
        'Cannot delete student with active enrollments in the current academic year',
      );
    }

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      await softDelete(tx, studentProfiles, id);
    });

    return true;
  }

  async listDeleted() {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      return tx
        .select({
          id: studentProfiles.id,
          firstName: userProfilesLive.firstName,
          lastName: userProfilesLive.lastName,
          identifier: studentProfiles.admissionNumber,
          deletedAt: sql<Date>`${studentProfiles.deletedAt}`.mapWith(studentProfiles.deletedAt),
        })
        .from(studentProfiles) // allow-base-read: the Deleted list shows trashed rows
        .innerJoin(userProfilesLive, eq(userProfilesLive.userId, studentProfiles.userId))
        .where(isNotNull(studentProfiles.deletedAt))
        .orderBy(desc(studentProfiles.deletedAt));
    });
  }

  async restore(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      const [deleted] = await tx
        .select({ admissionNumber: studentProfiles.admissionNumber })
        .from(studentProfiles) // allow-base-read: restore looks up a trashed row
        .where(and(eq(studentProfiles.id, id), isNotNull(studentProfiles.deletedAt)));
      if (!deleted) {
        throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Deleted student not found');
      }

      // The admission number is unique among live students only, so it may
      // have been reissued while this record sat in the Deleted list.
      const [taken] = await tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.admissionNumber, deleted.admissionNumber))
        .limit(1);
      if (taken) {
        throw new BusinessException(
          ErrorCode.ADMISSION_NUMBER_TAKEN,
          `Admission number ${deleted.admissionNumber} is now used by another student`,
        );
      }

      await tx
        .update(studentProfiles)
        .set({ deletedAt: null, deletedBy: null, updatedBy: actorId })
        .where(eq(studentProfiles.id, id));
    });

    return true;
  }

  // ── STATISTICS ────────────────────────────────────────────

  // ── PRIVATE HELPERS ───────────────────────────────────────

  private async validateStatusChange(
    tenantId: string,
    id: string,
    input: UpdateStudentInput,
  ): Promise<void> {
    const current = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({
            academicStatus: studentProfilesLive.academicStatus,
            tcIssued: studentProfilesLive.tcIssued,
          })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.id, id))
          .limit(1);
      },
    );

    if (current.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    STUDENT_ACADEMIC_STATE_MACHINE.assertTransition(
      current[0].academicStatus as AcademicStatus,
      input.academicStatus as AcademicStatus,
    );
    const tcIssued = input.tcIssued ?? current[0].tcIssued;
    if (input.academicStatus === AcademicStatus.TRANSFERRED_OUT && !tcIssued) {
      throw new BusinessException(
        ErrorCode.TC_REQUIRED_FOR_TRANSFER,
        'Cannot transfer out without issuing a Transfer Certificate',
      );
    }
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
    const exists = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ id: studentProfilesLive.id })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.id, id))
          .limit(1);
      },
    );

    if (exists.length === 0) {
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
    const updates: Record<string, unknown> = {};
    const fields = [
      'firstName',
      'lastName',
      'gender',
      'dateOfBirth',
      'bloodGroup',
      'religion',
      'motherTongue',
    ] as const;
    for (const field of fields) {
      if (input[field] !== undefined) updates[field] = input[field];
    }

    if (Object.keys(updates).length === 0) return;

    const profile = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ userId: studentProfilesLive.userId })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.id, id))
          .limit(1);
      },
    );

    await withAdmin(this.db, mkAdminCtx('service:student'), async (tx) => {
      await tx
        .update(userProfiles)
        .set({ ...updates, updatedBy: actorId })
        .where(eq(userProfiles.userId, profile[0].userId));
    });
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

  private async createUser(input: CreateStudentInput, actorId: string): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 12);
    const email = `student-${suffix}@roviq.placeholder`;
    const username = `student-${suffix}`;
    const phone = input.phone ? { countryCode: '+91', number: input.phone } : undefined;

    const { userId } = await this.identityService.createUser({
      email,
      username,
      phone,
      actorId,
    });

    return userId;
  }
}
