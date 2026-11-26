import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { createBillingActivities } from './billing.activities';
import { billingWorkflowsPath } from './billing.workflows-path';

/** The task queue the billing worker polls; every billing workflow is started on it. */
export const BILLING_TASK_QUEUE = 'billing-automation';

/** Runs the billing automation workflows (ROV-124) in this gateway when BILLING_WORKER_ENABLED is 'true'. */
@Injectable()
export class BillingWorkerService extends EmbeddedTemporalWorker {
  constructor(config: ConfigService) {
    super(config, {
      flag: 'BILLING_WORKER_ENABLED',
      label: 'Billing worker',
      taskQueue: BILLING_TASK_QUEUE,
      loggerName: BillingWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return { ...createBillingActivities(db) };
  }

  protected workflowsPath(): string {
    return billingWorkflowsPath();
  }
}
