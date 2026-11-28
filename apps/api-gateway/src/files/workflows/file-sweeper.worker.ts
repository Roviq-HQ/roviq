import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { Client, Connection } from '@temporalio/client';
import { FilePurgeRepository } from '../file-purge.repository';
import { FileSweeper } from '../file-sweeper';
import { createFileSweeperActivities } from './file-sweeper.activities';
import {
  ensureFileSweeperSchedule,
  FILE_MAINTENANCE_TASK_QUEUE,
  FILE_SWEEPER_SCHEDULE_ID,
} from './file-sweeper.schedule';
import { fileSweeperWorkflowsPath } from './file-sweeper.workflows-path';

/**
 * Runs the hourly file sweeper (ROV-300) in this gateway when FILE_SWEEPER_WORKER_ENABLED is
 * 'true', and keeps its schedule at the current spec. The sweeper only needs roviq_admin via withAdmin.
 */
@Injectable()
export class FileSweeperWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly storage: StorageClient,
  ) {
    super(config, {
      flag: 'FILE_SWEEPER_WORKER_ENABLED',
      label: 'File sweeper worker',
      taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
      loggerName: FileSweeperWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    const sweeper = new FileSweeper(
      new FilePurgeRepository(db, 'workflow:file-sweeper'),
      this.storage,
      new Logger(FileSweeper.name),
    );
    return createFileSweeperActivities(sweeper);
  }

  protected workflowsPath(): string {
    return fileSweeperWorkflowsPath();
  }

  /** The worker keeps serving an existing schedule even when this one cannot be brought up to date. */
  protected override async afterStart(address: string): Promise<void> {
    try {
      await this.ensureSchedule(address);
    } catch (err) {
      this.logger.error(
        { err },
        `File sweeper schedule ${FILE_SWEEPER_SCHEDULE_ID} could not be created or updated`,
      );
    }
  }

  private async ensureSchedule(address: string): Promise<void> {
    const clientConnection = await Connection.connect({ address });
    try {
      await ensureFileSweeperSchedule(
        new Client({ connection: clientConnection }).schedule,
        this.logger,
      );
    } finally {
      await clientConnection.close();
    }
  }
}
