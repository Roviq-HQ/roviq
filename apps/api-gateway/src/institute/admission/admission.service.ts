/** Admission service — enquiry CRM + application lifecycle (ROV-159). Queries live in AdmissionRepository. */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMISSION_APPLICATION_STATE_MACHINE,
  AdmissionApplicationStatus,
  BusinessException,
  EnquirySource,
  EnquiryStatus,
  ErrorCode,
  REJECTION_REASON_MAX_LENGTH,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import {
  Client as TemporalClient,
  Connection as TemporalConnection,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { AdmissionReadRepository } from './admission-read.repository';
import type {
  CreateApplicationInput,
  UpdateApplicationInput,
} from './dto/create-application.input';
import type { CreateEnquiryInput } from './dto/create-enquiry.input';
import type { UpdateEnquiryInput } from './dto/update-enquiry.input';
import type { ApplicationModel } from './models/application.model';
import type { EnquiryModel } from './models/enquiry.model';
import { AdmissionRepository } from './repositories/admission.repository';
import type { ApplicationUpdate } from './repositories/types';
import { STUDENT_ADMISSION_TASK_QUEUE } from './workflows/student-admission.types';

@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    private readonly repository: AdmissionRepository,
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

  // ══════════════════════════════════════════════════════════
  // ENQUIRY CRUD
  // ══════════════════════════════════════════════════════════

  async createEnquiry(input: CreateEnquiryInput): Promise<EnquiryModel & { isDuplicate: boolean }> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Auto-dedup: check for same phone + class combo
    const isDuplicate = await this.repository.hasDuplicateEnquiry(
      tenantId,
      input.parentPhone,
      input.classRequested,
    );

    const enquiryNumber = await this.repository.nextEnquiryNumber(tenantId);

    const enquiry = await this.repository.createEnquiry(tenantId, actorId, enquiryNumber, {
      studentName: input.studentName,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      classRequested: input.classRequested,
      academicYearId: input.academicYearId ?? null,
      parentName: input.parentName,
      parentPhone: input.parentPhone,
      parentEmail: input.parentEmail ?? null,
      parentRelation: input.parentRelation,
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
    });

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

    const enquiry = await this.repository.updateEnquiry(tenantId, id, updates);
    if (!enquiry) {
      throw new BusinessException(ErrorCode.ENQUIRY_NOT_FOUND, 'Enquiry not found');
    }

    return enquiry;
  }

  async convertEnquiryToApplication(
    enquiryId: string,
    standardId: string,
    academicYearId: string,
  ): Promise<ApplicationModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    // Load enquiry
    const enq = await this.repository.findEnquiry(tenantId, enquiryId);
    if (!enq) {
      throw new BusinessException(ErrorCode.ENQUIRY_NOT_FOUND, 'Enquiry not found');
    }

    if (enq.convertedToApplicationId) {
      throw new BusinessException(
        ErrorCode.ENQUIRY_ALREADY_CONVERTED,
        'Enquiry already converted to an application',
      );
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

    const application = await this.repository.convertEnquiry(tenantId, actorId, {
      enquiryId,
      application: {
        enquiryId,
        academicYearId,
        standardId,
        formData,
        status: AdmissionApplicationStatus.SUBMITTED,
        isRteApplication: false,
      },
      enquiryStatus: EnquiryStatus.APPLICATION_SUBMITTED,
    });

    this.logger.log(`Enquiry ${enquiryId} converted to application ${application.id}`);
    return application;
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
    if (!(await this.repository.standardExists(tenantId, input.standardId))) {
      throw new BusinessException(
        ErrorCode.STANDARD_NOT_FOUND,
        `Standard ${input.standardId} not found in this institute`,
      );
    }

    // Applications must target an ACTIVE academic year — admissions for
    // archived/completing years are not accepted, and planning years are not
    // yet open.
    const year = await this.repository.findAcademicYear(tenantId, input.academicYearId);
    if (!year) {
      throw new BusinessException(
        ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
        `Academic year ${input.academicYearId} not found in this institute`,
      );
    }
    if (!year.isActive) {
      throw new BusinessException(
        ErrorCode.ACADEMIC_YEAR_NOT_ACTIVE,
        `Academic year ${input.academicYearId} is not active — applications cannot be accepted`,
      );
    }

    const application = await this.repository.createApplication(tenantId, actorId, {
      enquiryId: input.enquiryId ?? null,
      academicYearId: input.academicYearId,
      standardId: input.standardId,
      sectionId: input.sectionId ?? null,
      formData: input.formData,
      status: AdmissionApplicationStatus.SUBMITTED,
      isRteApplication: input.isRteApplication ?? false,
    });

    this.logger.log(`Application created: ${application.id}`);
    return application;
  }

  async getApplication(id: string): Promise<ApplicationModel> {
    return this.readRepository.getForMutation(id, this.getTenantId());
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

    const oldStatus = await this.repository.findApplicationStatus(tenantId, id);
    if (!oldStatus) {
      throw new BusinessException(ErrorCode.APPLICATION_NOT_FOUND, 'Application not found');
    }

    ADMISSION_APPLICATION_STATE_MACHINE.assertTransition(oldStatus, input.status);

    const updates: ApplicationUpdate = {
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
    const updated = await this.repository.updateApplicationIfStatus(
      tenantId,
      id,
      oldStatus,
      updates,
    );
    if (!updated) {
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
    return updated;
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

    let current = await this.getApplication(id);
    ADMISSION_APPLICATION_STATE_MACHINE.assertTransition(
      current.status as AdmissionApplicationStatus,
      AdmissionApplicationStatus.ENROLLED,
    );

    // student_academics.section_id is NOT NULL: without a section the workflow
    // would create a student with no class placement.
    const targetSectionId = sectionId ?? current.sectionId;
    if (!targetSectionId) {
      throw new BusinessException(
        ErrorCode.SECTION_REQUIRED,
        'Choose a section before enrolling this applicant',
      );
    }
    if (!(await this.repository.sectionInStandard(tenantId, targetSectionId, current.standardId))) {
      throw new BusinessException(
        ErrorCode.SECTION_STANDARD_MISMATCH,
        'Section does not belong to the class this application is for',
      );
    }

    if (targetSectionId !== current.sectionId) {
      const updated = await this.repository.updateApplicationIfStatus(
        tenantId,
        id,
        AdmissionApplicationStatus.FEE_PAID,
        { sectionId: targetSectionId, updatedBy: actorId },
      );
      if (!updated) {
        throw new BusinessException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Application status changed while this update was in progress — reload and retry',
        );
      }
      current = updated;
    }

    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    const connection = await TemporalConnection.connect({ address });
    const workflowId = `student-admission-${id}`;
    try {
      const client = new TemporalClient({ connection });
      await client.workflow.start('StudentAdmissionWorkflow', {
        taskQueue: STUDENT_ADMISSION_TASK_QUEUE,
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
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
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
