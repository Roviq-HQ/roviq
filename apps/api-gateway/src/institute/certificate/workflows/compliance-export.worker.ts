import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '@roviq/event-bus';
import { StorageClient } from '@roviq/storage';
import { openWorkerDb } from '@roviq/temporal';
import { NativeConnection, Worker } from '@temporalio/worker';
import type { Pool } from 'pg';
import { WorkflowFileStore } from '../../../files/workflow-file-store';
import { ExportReportDrizzleRepository } from '../repositories/export-report.drizzle-repository';
import { createComplianceExportActivities } from './compliance-export.activities';
import { COMPLIANCE_EXPORT_TASK_QUEUE } from './compliance-export.types';
import { complianceExportWorkflowsPath } from './compliance-export.workflows-path';

/**
 * Runs ComplianceExportWorkflow (ROV-296) in this gateway when COMPLIANCE_EXPORT_WORKER_ENABLED
 * is 'true', and stops it on shutdown.
 */
@Injectable()
export class ComplianceExportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ComplianceExportWorkerService.name);
  private starting: Promise<void> | null = null;
  private worker: Worker | null = null;
  private running: Promise<void> | null = null;
  private connection: NativeConnection | null = null;
  private pool: Pool | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageClient,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('COMPLIANCE_EXPORT_WORKER_ENABLED') !== 'true') return;
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
      this.logError('Compliance export worker failed to start', err);
      await this.closeConnections();
      return;
    }
    this.worker = worker;
    this.running = worker
      .run()
      .catch((err: unknown) => this.logError('Compliance export worker stopped with an error', err))
      .finally(() => this.closeConnections());
    this.logger.log(`Compliance export worker started on queue: ${COMPLIANCE_EXPORT_TASK_QUEUE}`);
  }

  private async createWorker(address: string): Promise<Worker> {
    // The pooler role, like request traffic: every activity query runs as the institute via withTenant.
    const { db, pool } = openWorkerDb(this.config.getOrThrow<string>('DATABASE_URL'));
    this.pool = pool;
    this.connection = await NativeConnection.connect({ address });
    return Worker.create({
      connection: this.connection,
      taskQueue: COMPLIANCE_EXPORT_TASK_QUEUE,
      workflowsPath: complianceExportWorkflowsPath(),
      activities: createComplianceExportActivities({
        db,
        repo: new ExportReportDrizzleRepository(db),
        fileStore: new WorkflowFileStore(db, this.storage),
        eventBus: this.eventBus,
      }),
    });
  }

  private async closeConnections(): Promise<void> {
    const connection = this.connection;
    const pool = this.pool;
    this.connection = null;
    this.pool = null;
    try {
      await connection?.close();
    } catch (err) {
      this.logError('Compliance export Temporal connection failed to close', err);
    }
    try {
      await pool?.end();
    } catch (err) {
      this.logError('Compliance export database pool failed to close', err);
    }
  }

  private logError(message: string, err: unknown): void {
    this.logger.error(message, err instanceof Error ? err.stack : String(err));
  }
}
