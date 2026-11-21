import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EmbeddedTemporalWorker } from '../../common/temporal/embedded-temporal-worker';
import { InstituteSetupService } from '../management/seed/institute-setup.service';
import { createInstituteSetupActivities } from './institute-setup.activities';
import { INSTITUTE_SETUP_TASK_QUEUE } from './institute-setup.types';
import { instituteSetupWorkflowsPath } from './institute-setup.workflows-path';

/**
 * Runs InstituteSetupWorkflow (ROV-126, ROV-232) in this gateway when
 * INSTITUTE_SETUP_WORKER_ENABLED is 'true'. Without it an approved institute stays in setup.
 */
@Injectable()
export class InstituteSetupWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly eventBus: EventBusService,
    private readonly setup: InstituteSetupService,
  ) {
    super(config, {
      flag: 'INSTITUTE_SETUP_WORKER_ENABLED',
      label: 'Institute setup worker',
      taskQueue: INSTITUTE_SETUP_TASK_QUEUE,
      loggerName: InstituteSetupWorkerService.name,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return createInstituteSetupActivities(db, this.eventBus, this.setup);
  }

  protected workflowsPath(): string {
    return instituteSetupWorkflowsPath();
  }
}
