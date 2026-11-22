import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { IdentityService } from '../../../auth/identity.service';
import { createStudentAdmissionActivities } from './student-admission.activities';
import { STUDENT_ADMISSION_TASK_QUEUE } from './student-admission.types';
import { studentAdmissionWorkflowsPath } from './student-admission.workflows-path';

/**
 * Runs StudentAdmissionWorkflow (ROV-159) in this gateway when STUDENT_ADMISSION_WORKER_ENABLED
 * is 'true'. Without it `approveApplication` starts a workflow that never runs and the
 * application never reaches ENROLLED.
 */
@Injectable()
export class StudentAdmissionWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
  ) {
    super(config, {
      flag: 'STUDENT_ADMISSION_WORKER_ENABLED',
      label: 'Student admission worker',
      taskQueue: STUDENT_ADMISSION_TASK_QUEUE,
      loggerName: StudentAdmissionWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return createStudentAdmissionActivities(db, this.eventBus, this.identityService);
  }

  protected workflowsPath(): string {
    return studentAdmissionWorkflowsPath();
  }
}
