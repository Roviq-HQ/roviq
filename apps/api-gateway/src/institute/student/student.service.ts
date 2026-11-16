import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
/**
 * Student CRUD service (ROV-154).
 *
 * Direct service → Drizzle (no abstract repository).
 * Auth/user creation uses direct DB stubs (same pattern as bulk import).
 * TODO: Replace user creation with NATS calls when Identity Service is ready.
 */

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AcademicStatus,
  AdmissionType,
  BusinessException,
  ErrorCode,
  SocialCategory,
  STUDENT_ACADEMIC_STATE_MACHINE,
  USER_DOCUMENT_TYPE_VALUES,
  UserDocumentType,
} from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteConfigsLive,
  memberships,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  phoneNumbers,
  rolesLive,
  sections,
  softDelete,
  standardsLive,
  studentAcademics,
  studentAcademicsLive,
  studentProfiles,
  studentProfilesLive,
  tenantSequences,
  userDocuments,
  userProfiles,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { getRequestContext } from '@roviq/request-context';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { IdentityService } from '../../auth/identity.service';
import { resolveAdmissionPrefix, resolveAdmissionYear } from './admission-number';
import type { CreateStudentInput } from './dto/create-student.input';
import type { StudentFilterInput } from './dto/student-filter.input';
import type { UpdateStudentInput } from './dto/update-student.input';
import type { StudentModel } from './models/student.model';
import type { StudentDocumentModel } from './models/student-document.model';
import { StudentReadRepository } from './student-read.repository';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
    private readonly readRepository: StudentReadRepository,
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
          .select({ userId: phoneNumbers.userId })
          .from(phoneNumbers)
          .where(and(eq(phoneNumbers.countryCode, '+91'), eq(phoneNumbers.number, phone)))
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
      throw new NotFoundException('Student role not found for this institute');
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

    // 4. Generate admission number
    const admissionNumber = await this.generateAdmissionNumber(tenantId, input.standardId);

    // 5. Create student_profile
    const admissionDate = input.admissionDate ?? new Date().toISOString().split('T')[0];
    const newProfiles = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
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
   * Returns all uploaded documents for a single student. The student is
   * verified to belong to the current tenant via `withTenant` (RLS on
   * `student_profiles`); the actual `user_documents` rows are then read via
   * `withAdmin` because that table is platform-level (no RLS).
   *
   * Used by the Documents tab on the student detail page (ROV-167).
   * Returns the most-recently uploaded documents first.
   */
  /**
   * Records an uploaded document against a student's `user_documents` row.
   *
   * Flow (mirrors `listDocumentsForStudent`):
   *   1. Verify the student belongs to the current tenant via `withTenant`
   *      on `student_profiles` (RLS enforces tenant isolation) and resolve
   *      the owning `userId`.
   *   2. Insert into the platform-level `user_documents` table via
   *      `withAdmin` (no RLS on that table).
   *
   * The file bytes themselves are uploaded directly to MinIO/S3 by the
   * client; this mutation only persists the resulting URLs.
   *
   * Used by the "Upload Document" button on the student detail page
   * Documents tab (ROV-167).
   */
  async uploadDocument(input: {
    studentProfileId: string;
    type: UserDocumentType;
    description?: string;
    fileUrls: string[];
    referenceNumber?: string;
  }): Promise<StudentDocumentModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const allowedTypes = new Set<string>(USER_DOCUMENT_TYPE_VALUES);
    if (!allowedTypes.has(input.type)) {
      throw new UnprocessableEntityException({
        message: `Invalid document type '${input.type}'`,
        code: 'INVALID_DOCUMENT_TYPE',
      });
    }
    if (input.fileUrls.length === 0) {
      throw new UnprocessableEntityException({
        message: 'At least one file URL is required',
        code: 'FILE_URLS_REQUIRED',
      });
    }

    // 1. Verify the student belongs to this tenant and resolve their userId.
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
      throw new NotFoundException({
        message: 'Student not found',
        code: 'STUDENT_NOT_FOUND',
      });
    }
    const userId = studentRows[0].userId;

    // 2. Insert the new user_documents row (platform-level, no RLS).
    const inserted = await withAdmin(this.db, mkAdminCtx('service:student'), async (tx) => {
      const rows = await tx
        .insert(userDocuments)
        .values({
          userId,
          type: input.type,
          description: input.description ?? null,
          fileUrls: input.fileUrls,
          referenceNumber: input.referenceNumber ?? null,
        })
        .returning();
      return rows[0];
    });

    this.logger.log(
      `Student document uploaded: student=${input.studentProfileId} type=${input.type} actor=${actorId}`,
    );

    return {
      id: inserted.id,
      userId: inserted.userId,
      type: inserted.type,
      description: inserted.description,
      fileUrls: inserted.fileUrls,
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
      throw new NotFoundException({ message: 'Student not found', code: 'STUDENT_NOT_FOUND' });
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
      throw new NotFoundException({ message: 'Student not found', code: 'STUDENT_NOT_FOUND' });
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
      throw new UnprocessableEntityException({
        message: 'Cannot delete student with active enrollments in the current academic year',
        code: 'HAS_ACTIVE_ENROLLMENTS',
      });
    }

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      await softDelete(tx, studentProfiles, id);
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
      throw new NotFoundException({ message: 'Student not found', code: 'STUDENT_NOT_FOUND' });
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
      throw new NotFoundException({ message: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }
    throw new ConflictException({
      message: 'Concurrent modification detected — please reload and try again',
      code: 'CONCURRENT_MODIFICATION',
    });
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

  private async createUser(input: CreateStudentInput, _actorId: string): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 12);
    const email = `student-${suffix}@roviq.placeholder`;
    const username = `student-${suffix}`;
    const phone = input.phone ? { countryCode: '+91', number: input.phone } : undefined;

    const { userId } = await this.identityService.createUser({
      email,
      username,
      phone,
    });

    return userId;
  }

  private async generateAdmissionNumber(tenantId: string, standardId: string): Promise<string> {
    // Get institute config for admission number format
    const config = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ admissionNumberConfig: instituteConfigsLive.admissionNumberConfig })
          .from(instituteConfigsLive)
          .limit(1);
      },
    );

    const admConfig: AdmissionNumberConfig = config[0]?.admissionNumberConfig ?? {
      format: '{prefix}{value:04d}',
      year_format: 'YYYY',
      prefixes: {},
      no_prefix_from_class: 2,
    };

    // Get standard's numeric_order for prefix resolution
    const std = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        return tx
          .select({ numericOrder: standardsLive.numericOrder })
          .from(standardsLive)
          .where(eq(standardsLive.id, standardId))
          .limit(1);
      },
    );

    const numericOrder = std[0]?.numericOrder ?? 1;
    const prefix = resolveAdmissionPrefix(admConfig, numericOrder);
    const year = resolveAdmissionYear(admConfig);

    // Ensure sequence exists with correct prefix/format
    const formatTemplate = admConfig.format.replace('{year}', year);

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:student'), async (tx) => {
      await tx
        .insert(tenantSequences)
        .values({
          tenantId,
          sequenceName: 'adm_no',
          currentValue: 0n,
          prefix: prefix || null,
          formatTemplate,
        })
        .onConflictDoNothing();

      // Update prefix if it changed (e.g., different standard)
      await tx
        .update(tenantSequences)
        .set({ prefix: prefix || null })
        .where(
          and(eq(tenantSequences.tenantId, tenantId), eq(tenantSequences.sequenceName, 'adm_no')),
        );
    });

    // Atomic increment
    const result = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:student'),
      async (tx) => {
        const rows = await tx.execute(
          sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, 'adm_no')`,
        );
        return rows.rows[0] as { next_val: string; formatted: string } | undefined;
      },
    );

    if (!result) {
      throw new Error('Failed to generate admission number');
    }

    return result.formatted || `ADM-${result.next_val}`;
  }
}
