import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EmbeddedTemporalWorker } from '@roviq/temporal';
import { Client, Connection } from '@temporalio/client';
import { createPartitionActivities } from './partition.activities';
import {
  AUDIT_MAINTENANCE_TASK_QUEUE,
  AUDIT_PARTITION_SCHEDULE_ID,
  ensureAuditPartitionSchedule,
} from './partition.schedule';
import { auditPartitionWorkflowsPath } from './partition.workflows-path';

/**
 * Runs the monthly audit partition workflow (ROV-77, ROV-232) in this gateway when
 * AUDIT_PARTITION_WORKER_ENABLED is 'true', and keeps its schedule at the current spec.
 * AuditPartitionMaintainer already creates partitions; retention needs this worker.
 */
@Injectable()
export class AuditPartitionWorkerService extends EmbeddedTemporalWorker {
  constructor(config: ConfigService) {
    super(config, {
      flag: 'AUDIT_PARTITION_WORKER_ENABLED',
      label: 'Audit partition worker',
      taskQueue: AUDIT_MAINTENANCE_TASK_QUEUE,
      loggerName: AuditPartitionWorkerService.name,
    });
  }

  protected createActivities(db: DrizzleDB) {
    return createPartitionActivities(db);
  }

  protected workflowsPath(): string {
    return auditPartitionWorkflowsPath();
  }

  /** The worker keeps serving an existing schedule even when this one cannot be updated. */
  protected override async afterStart(address: string): Promise<void> {
    const connection = await Connection.connect({ address });
    try {
      await ensureAuditPartitionSchedule(new Client({ connection }).schedule, this.logger);
    } catch (err) {
      throw new Error(
        `Audit partition schedule ${AUDIT_PARTITION_SCHEDULE_ID} could not be created or updated`,
        { cause: err },
      );
    } finally {
      await connection.close();
    }
  }
}
