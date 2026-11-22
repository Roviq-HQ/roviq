import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { IdentityService } from '../../../auth/identity.service';
import { WorkflowFileStore } from '../../../files/workflow-file-store';
import { createBulkStudentImportActivities } from './bulk-student-import.activities';
import { bulkStudentImportWorkflowsPath } from './bulk-student-import.workflows-path';

const TASK_QUEUE = 'student-bulk-import';

/**
 * Runs BulkStudentImportWorkflow (ROV-155, ROV-301) in this gateway when
 * STUDENT_IMPORT_WORKER_ENABLED is 'true'.
 */
@Injectable()
export class BulkStudentImportWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly identityService: IdentityService,
    private readonly storage: StorageClient,
  ) {
    super(config, {
      flag: 'STUDENT_IMPORT_WORKER_ENABLED',
      label: 'Student import worker',
      taskQueue: TASK_QUEUE,
      loggerName: BulkStudentImportWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    // No NATS client: student.admitted events are not wired yet; IdentityService emits
    // NOTIFICATION.user.created itself.
    return {
      ...createBulkStudentImportActivities(
        db,
        null,
        this.identityService,
        new WorkflowFileStore(db, this.storage),
      ),
    };
  }

  protected workflowsPath(): string {
    return bulkStudentImportWorkflowsPath();
  }
}
