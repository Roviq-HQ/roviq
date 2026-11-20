import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDrizzleDb } from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Pool } from 'pg';
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
 * 'true', keeps its schedule at the current spec, and stops both on shutdown.
 */
@Injectable()
export class FileSweeperWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileSweeperWorkerService.name);
  private starting: Promise<void> | null = null;
  private worker: Worker | null = null;
  private running: Promise<void> | null = null;
  private connection: NativeConnection | null = null;
  private pool: Pool | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageClient,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('FILE_SWEEPER_WORKER_ENABLED') !== 'true') return;
    this.starting = this.start();
  }

  async onModuleDestroy(): Promise<void> {
    // Whatever startup is still opening must exist before it can be closed.
    await this.starting;
    if (this.worker?.getState() === 'RUNNING') this.worker.shutdown();
    await this.running;
    await this.closeConnections();
  }

  private async start(): Promise<void> {
    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    let worker: Worker;
    try {
      worker = await this.createWorker(address);
    } catch (err) {
      this.logError('File sweeper worker failed to start', err);
      await this.closeConnections();
      return;
    }
    this.worker = worker;
    this.running = worker
      .run()
      .catch((err: unknown) => this.logError('File sweeper worker stopped with an error', err))
      .finally(() => this.closeConnections());
    this.logger.log(`File sweeper worker started on queue: ${FILE_MAINTENANCE_TASK_QUEUE}`);

    // The worker keeps serving an existing schedule even when this one cannot be brought up to date.
    try {
      await this.ensureSchedule(address);
    } catch (err) {
      this.logError(
        `File sweeper schedule ${FILE_SWEEPER_SCHEDULE_ID} could not be created or updated`,
        err,
      );
    }
  }

  private async createWorker(address: string): Promise<Worker> {
    // The pooler role, like request traffic: the sweeper only needs roviq_admin via withAdmin.
    this.pool = new Pool({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      max: 3,
    });
    const sweeper = new FileSweeper(
      new FilePurgeRepository(createDrizzleDb(this.pool), 'workflow:file-sweeper'),
      this.storage,
      new Logger(FileSweeper.name),
    );
    this.connection = await NativeConnection.connect({ address });
    return Worker.create({
      connection: this.connection,
      taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
      workflowsPath: fileSweeperWorkflowsPath(),
      activities: createFileSweeperActivities(sweeper),
    });
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

  private async closeConnections(): Promise<void> {
    const { connection, pool } = this;
    this.connection = null;
    this.pool = null;
    try {
      await connection?.close();
    } catch (err) {
      this.logError('File sweeper Temporal connection failed to close', err);
    }
    try {
      await pool?.end();
    } catch (err) {
      this.logError('File sweeper database pool failed to close', err);
    }
  }

  private logError(message: string, err: unknown): void {
    this.logger.error(message, err instanceof Error ? err.stack : String(err));
  }
}
