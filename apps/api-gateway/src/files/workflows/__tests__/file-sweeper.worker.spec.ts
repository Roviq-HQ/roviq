import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import { Connection } from '@temporalio/client';
import { NativeConnection, type State, Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { FILE_SWEEPER_SCHEDULE_ID } from '../file-sweeper.schedule';
import { FileSweeperWorkerService } from '../file-sweeper.worker';

const { ensureSchedule } = vi.hoisted(() => ({ ensureSchedule: vi.fn() }));
vi.mock('../file-sweeper.schedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../file-sweeper.schedule')>()),
  ensureFileSweeperSchedule: ensureSchedule,
}));

vi.mock('../file-sweeper.workflows-path', () => ({
  fileSweeperWorkflowsPath: () => '/workflows/file-sweeper.workflow',
}));

function configWith(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

const ENABLED = {
  FILE_SWEEPER_WORKER_ENABLED: 'true',
  DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
};

/** A worker whose `run()` lasts until `shutdown()`, like the real one. */
function fakeWorker() {
  let state: State = 'RUNNING';
  let stop = () => {};
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const shutdown = vi.fn(() => {
    state = 'STOPPED';
    stop();
  });
  const worker = createMock<Worker>({
    run: vi.fn(() => stopped),
    shutdown,
    getState: vi.fn(() => state),
  });
  return { worker, shutdown };
}

describe('FileSweeperWorkerService', () => {
  let error: MockInstance<Logger['error']>;

  beforeEach(() => {
    ensureSchedule.mockReset();
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function startable() {
    const nativeClose = vi.fn(async () => {});
    const clientClose = vi.fn(async () => {});
    const connect = vi
      .spyOn(NativeConnection, 'connect')
      .mockResolvedValue(createMock<NativeConnection>({ close: nativeClose }));
    vi.spyOn(Connection, 'connect').mockResolvedValue(
      createMock<Connection>({ close: clientClose }),
    );
    const { worker, shutdown } = fakeWorker();
    vi.spyOn(Worker, 'create').mockResolvedValue(worker);
    const poolEnd = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
    return { connect, nativeClose, clientClose, worker, shutdown, poolEnd };
  }

  it('should not connect to Temporal when the flag is off', async () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const service = new FileSweeperWorkerService(configWith({}), new FakeStorageClient());

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).not.toHaveBeenCalled();
  });

  it('should not connect to Temporal when the flag is anything but true', () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const service = new FileSweeperWorkerService(
      configWith({ FILE_SWEEPER_WORKER_ENABLED: '1' }),
      new FakeStorageClient(),
    );

    service.onModuleInit();

    expect(connect).not.toHaveBeenCalled();
  });

  it('should log, not throw, when the worker cannot start, and leave the schedule alone', async () => {
    vi.spyOn(NativeConnection, 'connect').mockRejectedValue(new Error('temporal unreachable'));
    const poolEnd = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
    const service = new FileSweeperWorkerService(configWith(ENABLED), new FakeStorageClient());

    expect(() => service.onModuleInit()).not.toThrow();
    await service.onModuleDestroy();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'File sweeper worker failed to start',
      expect.stringContaining('temporal unreachable'),
    );
    expect(ensureSchedule).not.toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('should keep the worker running and name the schedule when only the schedule fails', async () => {
    const { shutdown, clientClose } = startable();
    ensureSchedule.mockRejectedValue(new Error('schedule rejected'));
    const service = new FileSweeperWorkerService(configWith(ENABLED), new FakeStorageClient());

    service.onModuleInit();
    await vi.waitFor(() => expect(ensureSchedule).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        `File sweeper schedule ${FILE_SWEEPER_SCHEDULE_ID} could not be created or updated`,
        expect.stringContaining('schedule rejected'),
      ),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
    expect(clientClose).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });

  it('should stop the worker and close its connections on shutdown', async () => {
    const { worker, shutdown, nativeClose, clientClose, poolEnd } = startable();
    ensureSchedule.mockResolvedValue('updated');
    const service = new FileSweeperWorkerService(configWith(ENABLED), new FakeStorageClient());

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('should log a worker that stops with an error and still close its connections', async () => {
    const { worker, nativeClose, poolEnd } = startable();
    vi.mocked(worker.run).mockRejectedValue(new Error('worker crashed'));
    ensureSchedule.mockResolvedValue('updated');
    const service = new FileSweeperWorkerService(configWith(ENABLED), new FakeStorageClient());

    service.onModuleInit();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'File sweeper worker stopped with an error',
        expect.stringContaining('worker crashed'),
      ),
    );
    await vi.waitFor(() => expect(poolEnd).toHaveBeenCalledTimes(1));

    expect(nativeClose).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });
});
