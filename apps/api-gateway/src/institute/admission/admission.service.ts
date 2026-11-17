/**
 * Admission service — enquiry CRM + application lifecycle + statistics (ROV-159).
 *
 * Direct service → Drizzle (no abstract repository).
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMISSION_APPLICATION_STATE_MACHINE,
  AdmissionApplicationStatus,
  BusinessException,
  EnquirySource,
  EnquiryStatus,
  ErrorCode,
  GuardianRelationship,
  REJECTION_REASON_MAX_LENGTH,
} from '@roviq/common-types';
import {
  academicYearsLive,
  admissionApplications,
  admissionApplicationsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  enquiries,
  enquiriesLive,
  mkInstituteCtx,
  sectionsLive,
  standardsLive,
  tenantSequences,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import {
  Client as TemporalClient,
  Connection as TemporalConnection,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { and, eq, sql } from 'drizzle-orm';
import { AdmissionReadRepository } from './admission-read.repository';
import { toApplicationModel, toEnquiryModel } from './admission-records';
import type {
  CreateApplicationInput,
  UpdateApplicationInput,
} from './dto/create-application.input';
import type { CreateEnquiryInput } from './dto/create-enquiry.input';
import type { UpdateEnquiryInput } from './dto/update-enquiry.input';
import type { ApplicationModel } from './models/application.model';
import type { EnquiryModel } from './models/enquiry.model';

/**
 * Drizzle row types — single source of truth for the shape returned by
 * `db.select().from(...)`. The mapper functions below pluck the subset of
 * fields the GraphQL `EnquiryModel`/`ApplicationModel` exposes, eliminating
 * the `as unknown as Model` casts banned by the [NTESC] hard rule.
 */
@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly eventBus: EventBusService,
    private readonly readRepository: AdmissionReadRepository,
    private readonly config: ConfigService,
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

  /**
   * Generate the next human-readable enquiry number (e.g. `ENQ-000123`).
   * Uses the atomic `next_sequence_value()` function with a per-tenant
   * `enq_no` row in `tenant_sequences`, creating it on first use.
   */
  private async generateEnquiryNumber(tenantId: string): Promise<string> {
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:admission'), async (tx) => {
      await tx
        .insert(tenantSequences)
        .values({
          tenantId,
          sequenceName: 'enq_no',
          currentValue: 0n,
          formatTemplate: 'ENQ-{value:06d}',
        })
        .onConflictDoNothing();
      const result = await tx.execute(
        sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, 'enq_no')`,
      );
      const row = result.rows[0] as { next_val: string; formatted: string };
      return row.formatted || `ENQ-${row.next_val}`;
    });
  }

  // ══════════════════════════════════════════════════════════
  // ENQUIRY CRUD
  // ══════════════════════════════════════════════════════════

  async createEnquiry(input: CreateEnquiryInput): Promise<EnquiryModel & { isDuplicate: boolean }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Auto-dedup: check for same phone + class combo
    const duplicates = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx
          .select({ id: enquiriesLive.id })
          .from(enquiriesLive)
          .where(
            and(
              eq(enquiriesLive.parentPhone, input.parentPhone),
              eq(enquiriesLive.classRequested, input.classRequested),
            ),
          )
          .limit(1);
      },
    );

    const isDuplicate = duplicates.length > 0;

    const enquiryNumber = await this.generateEnquiryNumber(tenantId);

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx
          .insert(enquiries)
          .values({
            tenantId,
            enquiryNumber,
            studentName: input.studentName,
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
            classRequested: input.classRequested,
            academicYearId: input.academicYearId ?? null,
            parentName: input.parentName,
            parentPhone: input.parentPhone,
            parentEmail: input.parentEmail ?? null,
            parentRelation: input.parentRelation ?? GuardianRelationship.FATHER,
            source: input.source ?? EnquirySource.WALK_IN,
            referredBy: input.referredBy ?? null,
            assignedTo: input.assignedTo ?? null,
            previousSchool: input.previousSchool ?? null,
            previousBoard: input.previousBoard ?? null,
            siblingInSchool: input.siblingInSchool ?? false,
            siblingAdmissionNo: input.siblingAdmissionNo ?? null,
            specialNeeds: input.specialNeeds ?? null,
            notes: input.notes ?? null,
            status: EnquiryStatus.NEW,
            followUpDate: input.followUpDate ?? null,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
      },
    );

    const enquiry = toEnquiryModel(rows[0]);

    // Spread the full record so the `@Subscription(() => EnquiryModel)`
    // resolver can serve any selected field (id, etc.) without null-field
    // errors. The enquiryId alias + isDuplicate stay for downstream NATS
    // consumers that already depend on them.
    this.eventBus.emit(EVENT_PATTERNS.ENQUIRY.created, {
      ...enquiry,
      enquiryId: enquiry.id,
      tenantId,
      isDuplicate,
    });

    this.logger.log(`Enquiry created: ${enquiry.id} (duplicate: ${isDuplicate})`);

    return { ...enquiry, isDuplicate };
  }

  async updateEnquiry(id: string, input: UpdateEnquiryInput): Promise<EnquiryModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const updates: Record<string, unknown> = { updatedBy: actorId };
    const fields = [
      'studentName',
      'classRequested',
      'parentName',
      'parentPhone',
      'parentEmail',
      'status',
      'followUpDate',
      'assignedTo',
      'notes',
      'source',
      'referredBy',
      'siblingInSchool',
      'siblingAdmissionNo',
      'specialNeeds',
    ] as const;
    for (const field of fields) {
      if (input[field] !== undefined) updates[field] = input[field];
    }

    if (input.status === EnquiryStatus.CONTACTED || input.status === EnquiryStatus.CAMPUS_VISITED) {
      updates.lastContactedAt = new Date();
    }

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx.update(enquiries).set(updates).where(eq(enquiries.id, id)).returning();
      },
    );

    if (rows.length === 0) {
      throw new NotFoundException('Enquiry not found');
    }

    return toEnquiryModel(rows[0]);
  }

  async convertEnquiryToApplication(
    enquiryId: string,
    standardId: string,
    academicYearId: string,
  ): Promise<ApplicationModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Load enquiry
    const enqRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx.select().from(enquiriesLive).where(eq(enquiriesLive.id, enquiryId)).limit(1);
      },
    );

    if (enqRows.length === 0) {
      throw new NotFoundException('Enquiry not found');
    }

    const enq = enqRows[0];

    if (enq.convertedToApplicationId) {
      throw new ConflictException('Enquiry already converted to an application');
    }

    // Create application from enquiry data
    const formData = {
      studentName: enq.studentName,
      dateOfBirth: enq.dateOfBirth,
      gender: enq.gender,
      parentName: enq.parentName,
      parentPhone: enq.parentPhone,
      parentEmail: enq.parentEmail,
      parentRelation: enq.parentRelation,
      previousSchool: enq.previousSchool,
      previousBoard: enq.previousBoard,
      specialNeeds: enq.specialNeeds,
    };

    const appRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        const apps = await tx
          .insert(admissionApplications)
          .values({
            tenantId,
            enquiryId,
            academicYearId,
            standardId,
            formData,
            status: AdmissionApplicationStatus.SUBMITTED,
            isRteApplication: false,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();

        // Update enquiry
        await tx
          .update(enquiries)
          .set({
            status: EnquiryStatus.APPLICATION_SUBMITTED,
            convertedToApplicationId: apps[0].id,
            updatedBy: actorId,
          })
          .where(eq(enquiries.id, enquiryId));

        return apps;
      },
    );

    this.logger.log(`Enquiry ${enquiryId} converted to application ${appRows[0].id}`);
    return toApplicationModel(appRows[0]);
  }

  // ══════════════════════════════════════════════════════════
  // APPLICATION CRUD
  // ══════════════════════════════════════════════════════════

  async createApplication(input: CreateApplicationInput): Promise<ApplicationModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Validate the referenced standard exists in this tenant before writing.
    // The FK would catch a missing row, but the domain error surfaces a clearer
    // message to the caller and avoids a round-trip for a generic 500.
    const standardRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx
          .select({ id: standardsLive.id })
          .from(standardsLive)
          .where(eq(standardsLive.id, input.standardId))
          .limit(1);
      },
    );
    if (standardRows.length === 0) {
      throw new NotFoundException(`Standard ${input.standardId} not found in this institute`);
    }

    // Applications must target an ACTIVE academic year — admissions for
    // archived/completing years are not accepted, and planning years are not
    // yet open.
    const yearRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx
          .select({ id: academicYearsLive.id, isActive: academicYearsLive.isActive })
          .from(academicYearsLive)
          .where(eq(academicYearsLive.id, input.academicYearId))
          .limit(1);
      },
    );
    if (yearRows.length === 0) {
      throw new NotFoundException(
        `Academic year ${input.academicYearId} not found in this institute`,
      );
    }
    if (!yearRows[0].isActive) {
      throw new ConflictException(
        `Academic year ${input.academicYearId} is not active — applications cannot be accepted`,
      );
    }

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:admission'),
      async (tx) => {
        return tx
          .insert(admissionApplications)
          .values({
            tenantId,
            enquiryId: input.enquiryId ?? null,
            academicYearId: input.academicYearId,
            standardId: input.standardId,
            sectionId: input.sectionId ?? null,
            formData: input.formData,
            status: AdmissionApplicationStatus.SUBMITTED,
            isRteApplication: input.isRteApplication ?? false,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
      },
    );

    this.logger.log(`Application created: ${rows[0].id}`);
    return toApplicationModel(rows[0]);
  }

  async getApplication(id: string): Promise<ApplicationModel> {
    return this.readRepository.getForMutation(
      id,
      mkInstituteCtx(this.getTenantId(), 'service:admission'),
    );
  }

  async updateApplication(id: string, input: UpdateApplicationInput): Promise<ApplicationModel> {
    // ENROLLED is written only by StudentAdmissionWorkflow, together with student_profile_id.
    if (input.status === AdmissionApplicationStatus.ENROLLED) {
      throw new BusinessException(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Enrolment runs through approveApplication, not a direct status update',
      );
    }
    return this.transitionApplication(id, input, {});
  }

  private async transitionApplication(
    id: string,
    input: UpdateApplicationInput,
    extra: { rejectionReason?: string | null },
  ): Promise<ApplicationModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const ctx = mkInstituteCtx(tenantId, 'service:admission');

    const current = await withTenant(this.db, ctx, async (tx) => {
      return tx
        .select({ status: admissionApplicationsLive.status })
        .from(admissionApplicationsLive)
        .where(eq(admissionApplicationsLive.id, id))
        .limit(1);
    });

    if (current.length === 0) {
      throw new NotFoundException('Application not found');
    }

    const oldStatus = current[0].status;
    ADMISSION_APPLICATION_STATE_MACHINE.assertTransition(oldStatus, input.status);

    const updates: Partial<typeof admissionApplications.$inferInsert> = {
      status: input.status,
      updatedBy: actorId,
    };

    if (input.sectionId !== undefined) updates.sectionId = input.sectionId;
    if (input.formData !== undefined) updates.formData = input.formData;
    if (input.testScore !== undefined) updates.testScore = input.testScore;
    if (input.interviewScore !== undefined) updates.interviewScore = input.interviewScore;
    if (input.meritRank !== undefined) updates.meritRank = input.meritRank;

    const now = new Date();
    if (input.status === AdmissionApplicationStatus.OFFER_MADE) updates.offeredAt = now;
    if (input.status === AdmissionApplicationStatus.OFFER_ACCEPTED) updates.offerAcceptedAt = now;
    if (input.status === AdmissionApplicationStatus.REJECTED) {
      updates.rejectedAt = now;
      updates.rejectionReason = extra.rejectionReason ?? null;
    }

    // Status predicate makes the transition atomic: a concurrent writer that
    // already moved the row leaves this UPDATE matching nothing.
    const rows = await withTenant(this.db, ctx, async (tx) => {
      return tx
        .update(admissionApplications)
        .set(updates)
        .where(and(eq(admissionApplications.id, id), eq(admissionApplications.status, oldStatus)))
        .returning();
    });

    if (rows.length === 0) {
      throw new BusinessException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Application status changed while this update was in progress — reload and retry',
      );
    }

    this.eventBus.emit(EVENT_PATTERNS.APPLICATION.status_changed, {
      applicationId: id,
      oldStatus,
      newStatus: input.status,
      tenantId,
    });

    this.logger.log(`Application ${id}: ${oldStatus} → ${input.status}`);
    return toApplicationModel(rows[0]);
  }

  /**
   * Starts StudentAdmissionWorkflow and returns the application still FEE_PAID.
   * The workflow's `updateApplicationEnrolled` activity is the only writer of
   * ENROLLED — it sets status and `student_profile_id` together and publishes
   * `applicationStatusChanged` once the student exists.
   */
  async approveAndEnroll(id: string, sectionId?: string): Promise<ApplicationModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const ctx = mkInstituteCtx(tenantId, 'service:admission');

    let current = await this.getApplication(id);
    ADMISSION_APPLICATION_STATE_MACHINE.assertTransition(
      current.status as AdmissionApplicationStatus,
      AdmissionApplicationStatus.ENROLLED,
    );

    // student_academics.section_id is NOT NULL: without a section the workflow
    // would create a student with no class placement.
    const targetSectionId = sectionId ?? current.sectionId;
    if (!targetSectionId) {
      throw new BadRequestException('Choose a section before enrolling this applicant');
    }
    const section = await withTenant(this.db, ctx, async (tx) => {
      return tx
        .select({ id: sectionsLive.id })
        .from(sectionsLive)
        .where(
          and(
            eq(sectionsLive.id, targetSectionId),
            eq(sectionsLive.standardId, current.standardId),
          ),
        )
        .limit(1);
    });
    if (section.length === 0) {
      throw new BadRequestException('Section does not belong to the class this application is for');
    }

    if (targetSectionId !== current.sectionId) {
      const rows = await withTenant(this.db, ctx, async (tx) => {
        return tx
          .update(admissionApplications)
          .set({ sectionId: targetSectionId, updatedBy: actorId })
          .where(
            and(
              eq(admissionApplications.id, id),
              eq(admissionApplications.status, AdmissionApplicationStatus.FEE_PAID),
            ),
          )
          .returning();
      });
      if (rows.length === 0) {
        throw new BusinessException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Application status changed while this update was in progress — reload and retry',
        );
      }
      current = toApplicationModel(rows[0]);
    }

    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    const connection = await TemporalConnection.connect({ address });
    const workflowId = `student-admission-${id}`;
    try {
      const client = new TemporalClient({ connection });
      await client.workflow.start('StudentAdmissionWorkflow', {
        taskQueue: 'student-admission',
        workflowId,
        workflowExecutionTimeout: '5 minutes',
        args: [{ applicationId: id, tenantId, actorId }],
      });
      this.logger.log(`Started StudentAdmissionWorkflow: ${workflowId} for application ${id}`);
    } catch (err) {
      // Stable workflow ID per application: a repeat approval while the first
      // run is in flight joins it instead of starting a parallel enrolment.
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
      this.logger.log(`StudentAdmissionWorkflow ${workflowId} already running — not restarted`);
    } finally {
      await connection.close();
    }

    return current;
  }

  async rejectApplication(id: string, reason?: string): Promise<ApplicationModel> {
    const rejectionReason = reason?.trim() || null;
    if (rejectionReason && rejectionReason.length > REJECTION_REASON_MAX_LENGTH) {
      throw new BadRequestException(
        `Rejection reason must be at most ${REJECTION_REASON_MAX_LENGTH} characters`,
      );
    }
    return this.transitionApplication(
      id,
      { status: AdmissionApplicationStatus.REJECTED },
      { rejectionReason },
    );
  }

  // ══════════════════════════════════════════════════════════
  // ADMISSION STATISTICS
  // ══════════════════════════════════════════════════════════
}
