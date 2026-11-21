import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import { NativeConnection, type State, Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ComplianceExportWorkerService } from '../workflows/compliance-export.worker';

vi.mock('../workflows/compliance-export.workflows-path', () => ({
  complianceExportWorkflowsPath: () => '/workflows/compliance-export.workflow',
}));

const ENABLED = {
  COMPLIANCE_EXPORT_WORKER_ENABLED: 'true',
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

function service(values: Record<string, string>) {
  return new ComplianceExportWorkerService(
    new ConfigService(values),
    new FakeStorageClient(),
    createMock<EventBusService>(),
  );
}

describe('ComplianceExportWorkerService', () => {
  let error: MockInstance<Logger['error']>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function startable() {
    const nativeClose = vi.fn(async () => {});
    const connect = vi
      .spyOn(NativeConnection, 'connect')
      .mockResolvedValue(createMock<NativeConnection>({ close: nativeClose }));
    const { worker, shutdown } = fakeWorker();
    const create = vi.spyOn(Worker, 'create').mockResolvedValue(worker);
    const poolEnd = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
    return { connect, create, nativeClose, worker, shutdown, poolEnd };
  }

  it('should not connect to Temporal when the flag is off', async () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const worker = service({});

    worker.onModuleInit();
    await worker.onModuleDestroy();

    expect(connect).not.toHaveBeenCalled();
  });

  it('should not connect to Temporal when the flag is anything but true', () => {
    const connect = vi.spyOn(NativeConnection, 'connect');

    service({ COMPLIANCE_EXPORT_WORKER_ENABLED: '1' }).onModuleInit();

    expect(connect).not.toHaveBeenCalled();
  });

  it('should register the export workflow and activities on the compliance-export queue', async () => {
    const { create } = startable();
    const worker = service(ENABLED);

    worker.onModuleInit();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: 'compliance-export',
        workflowsPath: '/workflows/compliance-export.workflow',
      }),
    );
    const options = create.mock.calls[0]?.[0];
    expect(Object.keys(options?.activities ?? {}).sort()).toEqual([
      'generateExportFile',
      'markExportCompleted',
      'markExportFailed',
      'markExportRunning',
    ]);
    await worker.onModuleDestroy();
  });

  it('should log, not throw, when the worker cannot start, and close the pool', async () => {
    vi.spyOn(NativeConnection, 'connect').mockRejectedValue(new Error('temporal unreachable'));
    const poolEnd = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
    const worker = service(ENABLED);

    expect(() => worker.onModuleInit()).not.toThrow();
    await worker.onModuleDestroy();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Compliance export worker failed to start',
      expect.stringContaining('temporal unreachable'),
    );
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('should stop the worker and close its connections on shutdown', async () => {
    const { worker: temporalWorker, shutdown, nativeClose, poolEnd } = startable();
    const worker = service(ENABLED);

    worker.onModuleInit();
    await worker.onModuleDestroy();

    expect(temporalWorker.run).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('should log a worker that stops with an error and still close its connections', async () => {
    const { worker: temporalWorker, nativeClose, poolEnd } = startable();
    vi.mocked(temporalWorker.run).mockRejectedValue(new Error('worker crashed'));
    const worker = service(ENABLED);

    worker.onModuleInit();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Compliance export worker stopped with an error',
        expect.stringContaining('worker crashed'),
      ),
    );
    await vi.waitFor(() => expect(poolEnd).toHaveBeenCalledTimes(1));

    expect(nativeClose).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });
});
