import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EmbeddedTemporalWorker } from '../../../common/temporal/embedded-temporal-worker';
import { createTCIssuanceActivities } from './tc-issuance.activities';
import { DEFAULT_TC_TASK_QUEUE } from './tc-issuance.types';
import { tcIssuanceWorkflowsPath } from './tc-issuance.workflows-path';

/**
 * Runs TCIssuanceWorkflow (ROV-161, ROV-232) in this gateway when TC_ISSUANCE_WORKER_ENABLED is
 * 'true'. Without it a requested TC stays REQUESTED and can never be approved or issued.
 */
@Injectable()
export class TCIssuanceWorkerService extends EmbeddedTemporalWorker {
  constructor(config: ConfigService) {
    super(config, {
      flag: 'TC_ISSUANCE_WORKER_ENABLED',
      label: 'TC issuance worker',
      // Same variable and default as CertificateService uses to start the workflow.
      taskQueue: config.get<string>('TEMPORAL_TC_TASK_QUEUE', DEFAULT_TC_TASK_QUEUE),
      loggerName: TCIssuanceWorkerService.name,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return createTCIssuanceActivities(db);
  }

  protected workflowsPath(): string {
    return tcIssuanceWorkflowsPath();
  }
}
