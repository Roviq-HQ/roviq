import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageClient } from '@roviq/storage';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createDrizzleForWorker } from '../../common/temporal/worker-db';
import { FilePurgeRepository } from '../file-purge.repository';
import { FileSweeper } from '../file-sweeper';
import { createFileSweeperActivities } from './file-sweeper.activities';
import { ensureFileSweeperSchedule, FILE_MAINTENANCE_TASK_QUEUE } from './file-sweeper.schedule';

/**
 * Runs the hourly file sweeper (ROV-300) in this gateway when FILE_SWEEPER_WORKER_ENABLED is
 * 'true', and makes sure its schedule exists.
 */
@Injectable()
export class FileSweeperWorkerService implements OnModuleInit {
  private readonly logger = new Logger(FileSweeperWorkerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageClient,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('FILE_SWEEPER_WORKER_ENABLED') !== 'true') return;

    this.startWorker().catch((err: unknown) => {
      this.logger.error(
        'File sweeper worker failed to start',
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private async startWorker(): Promise<void> {
    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    // The pooler role, like request traffic: the sweeper only needs roviq_admin via withAdmin.
    const db = await createDrizzleForWorker(this.config.getOrThrow<string>('DATABASE_URL'));
    const sweeper = new FileSweeper(
      new FilePurgeRepository(db, 'workflow:file-sweeper'),
      this.storage,
      new Logger(FileSweeper.name),
    );

    const worker = await Worker.create({
      connection: await NativeConnection.connect({ address }),
      taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
      workflowsPath: require.resolve('./file-sweeper.workflow'),
      activities: createFileSweeperActivities(sweeper),
    });

    const clientConnection = await Connection.connect({ address });
    try {
      await ensureFileSweeperSchedule(
        new Client({ connection: clientConnection }).schedule,
        this.logger,
      );
    } finally {
      await clientConnection.close();
    }

    this.logger.log(`File sweeper worker started on queue: ${FILE_MAINTENANCE_TASK_QUEUE}`);
    await worker.run();
  }
}
