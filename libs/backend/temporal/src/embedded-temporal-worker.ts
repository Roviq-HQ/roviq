import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { NativeConnection, Worker, type WorkerOptions } from '@temporalio/worker';
import type { Pool } from 'pg';
import { openWorkerDb } from './worker-db';

/**
 * `disabled`: flag off. `stopped`: failed to start, crashed or shut down; it stays `stopped`
 * while a retry is pending or opening, unless the worker opts into `restartDelayMs`.
 */
export type EmbeddedWorkerStatus = 'disabled' | 'starting' | 'running' | 'stopped';

/** Docker restarts only an exited process, so a stopped worker must start itself again. */
export const EMBEDDED_WORKER_RESTART_DELAY_MS = 30_000;

/**
 * A Temporal worker that runs inside the app (api-gateway, notification-service) when its `*_WORKER_ENABLED` flag is 'true',
 * and stops cleanly on shutdown. Same lifecycle as the file sweeper and compliance export
 * workers (ROV-300, ROV-296): a start failure is logged, never thrown; the pool and the
 * Temporal connection are always closed.
 */
export abstract class EmbeddedTemporalWorker implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: Logger;
  private starting: Promise<void> | null = null;
  private worker: Worker | null = null;
  private running: Promise<void> | null = null;
  private connection: NativeConnection | null = null;
  private pool: Pool | null = null;
  private status: EmbeddedWorkerStatus = 'disabled';
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(
    protected readonly config: ConfigService,
    private readonly settings: {
      /** Environment flag that switches the worker on. */
      flag: string;
      /** Used in log lines, e.g. "TC issuance worker". */
      label: string;
      taskQueue: string;
      loggerName: string;
      /** Opt-in: start again this long after a failed start or an ended run, until shutdown. */
      restartDelayMs?: number;
    },
  ) {
    this.logger = new Logger(settings.loggerName);
  }

  /** Activities bound to the worker's own database pool. */
  protected abstract createActivities(db: DrizzleDB): NonNullable<WorkerOptions['activities']>;

  /** The workflow module to bundle; a function in its own file so tests can replace it. */
  protected abstract workflowsPath(): string;

  /** Runs once the worker polls, e.g. to bring a schedule up to date. Failures are logged. */
  protected async afterStart(_address: string): Promise<void> {}

  get workerStatus(): EmbeddedWorkerStatus {
    return this.status;
  }

  onModuleInit(): void {
    if (this.config.get<string>(this.settings.flag) !== 'true') return;
    this.status = 'starting';
    this.starting = this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    // Whatever startup is still opening must exist before it can be closed.
    await this.starting;
    const wasRunning = this.worker?.getState() === 'RUNNING';
    if (wasRunning) this.worker?.shutdown();
    await this.running;
    await this.closeConnections();
    if (wasRunning) this.logger.log(`${this.settings.label} stopped`);
  }

  private async start(): Promise<void> {
    const { label, taskQueue } = this.settings;
    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    let worker: Worker;
    try {
      worker = await this.createWorker(address);
    } catch (err) {
      this.status = 'stopped';
      this.logError(`${label} failed to start`, err);
      await this.closeConnections();
      this.scheduleRestart();
      return;
    }
    this.worker = worker;
    this.status = 'running';
    this.running = worker
      .run()
      .catch((err: unknown) => this.logError(`${label} stopped with an error`, err))
      .finally(async () => {
        this.status = 'stopped';
        await this.closeConnections();
        this.scheduleRestart();
      });
    this.logger.log(`${label} started on queue: ${taskQueue}`);

    try {
      await this.afterStart(address);
    } catch (err) {
      this.logError(`${label} post-start step failed`, err);
    }
  }

  private scheduleRestart(): void {
    const delay = this.settings.restartDelayMs;
    if (delay === undefined || this.destroyed) return;
    this.logger.warn(`${this.settings.label} will try to start again in ${delay} ms`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.destroyed) return;
      // Status stays `stopped` until the start succeeds, so health keeps reporting the outage.
      this.starting = this.start();
    }, delay);
  }

  private async createWorker(address: string): Promise<Worker> {
    // The pooler role, like request traffic: activities reach roviq_app/roviq_admin through the wrappers.
    const { db, pool } = openWorkerDb(this.config.getOrThrow<string>('DATABASE_URL'));
    this.pool = pool;
    this.connection = await NativeConnection.connect({ address });
    return Worker.create({
      connection: this.connection,
      taskQueue: this.settings.taskQueue,
      workflowsPath: this.workflowsPath(),
      activities: this.createActivities(db),
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
      this.logError(`${this.settings.label} Temporal connection failed to close`, err);
    }
    try {
      await pool?.end();
    } catch (err) {
      this.logError(`${this.settings.label} database pool failed to close`, err);
    }
  }

  private logError(message: string, err: unknown): void {
    this.logger.error({ err }, message);
  }
}
