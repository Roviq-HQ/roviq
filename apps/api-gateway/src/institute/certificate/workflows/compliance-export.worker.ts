import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { StorageClient } from '@roviq/storage';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { WorkflowFileStore } from '../../../files/workflow-file-store';
import { ExportReportDrizzleRepository } from '../repositories/export-report.drizzle-repository';
import { createComplianceExportActivities } from './compliance-export.activities';
import { COMPLIANCE_EXPORT_TASK_QUEUE } from './compliance-export.types';
import { complianceExportWorkflowsPath } from './compliance-export.workflows-path';

/**
 * Runs ComplianceExportWorkflow (ROV-296) in this gateway when COMPLIANCE_EXPORT_WORKER_ENABLED
 * is 'true'. Every activity query runs as the institute via withTenant.
 */
@Injectable()
export class ComplianceExportWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly storage: StorageClient,
    private readonly eventBus: EventBusService,
  ) {
    super(config, {
      flag: 'COMPLIANCE_EXPORT_WORKER_ENABLED',
      label: 'Compliance export worker',
      taskQueue: COMPLIANCE_EXPORT_TASK_QUEUE,
      loggerName: ComplianceExportWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return createComplianceExportActivities({
      db,
      repo: new ExportReportDrizzleRepository(db),
      fileStore: new WorkflowFileStore(db, this.storage),
      eventBus: this.eventBus,
    });
  }

  protected workflowsPath(): string {
    return complianceExportWorkflowsPath();
  }
}
