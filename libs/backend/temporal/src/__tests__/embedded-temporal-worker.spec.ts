import assert from 'node:assert';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { NativeConnection, type State, Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { EmbeddedTemporalWorker } from '../embedded-temporal-worker';

const FLAG = 'TEST_WORKER_ENABLED';
const TASK_QUEUE = 'test-queue';

const ENABLED = {
  [FLAG]: 'true',
  DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
};

class TestWorker extends EmbeddedTemporalWorker {
  readonly afterStartFn = vi.fn(async (_address: string) => {});

  constructor(config: ConfigService) {
    super(config, {
      flag: FLAG,
      label: 'Test worker',
      taskQueue: TASK_QUEUE,
      loggerName: TestWorker.name,
    });
  }

  protected createActivities() {
    return { noop: async () => 'ok' };
  }

  protected workflowsPath(): string {
    return '/workflows/test.workflow';
  }

  protected override afterStart(address: string): Promise<void> {
    return this.afterStartFn(address);
  }
}

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

describe('EmbeddedTemporalWorker', () => {
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

  it('should do nothing when the flag is off', async () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const create = vi.spyOn(Worker, 'create');
    const service = new TestWorker(new ConfigService({}));

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(service.afterStartFn).not.toHaveBeenCalled();
  });

  it('should do nothing when the flag is anything but true', async () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const service = new TestWorker(new ConfigService({ ...ENABLED, [FLAG]: '1' }));

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).not.toHaveBeenCalled();
  });

  it('should log, not throw, when the worker cannot start, and close the pool', async () => {
    vi.spyOn(NativeConnection, 'connect').mockRejectedValue(new Error('temporal unreachable'));
    const poolEnd = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
    const service = new TestWorker(new ConfigService(ENABLED));

    expect(() => service.onModuleInit()).not.toThrow();
    await service.onModuleDestroy();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Test worker failed to start',
      expect.stringContaining('temporal unreachable'),
    );
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(service.afterStartFn).not.toHaveBeenCalled();
  });

  it('should close the Temporal connection and the pool when Worker.create fails', async () => {
    const { nativeClose, poolEnd } = startable();
    vi.mocked(Worker.create).mockRejectedValue(new Error('bundle failed'));
    const service = new TestWorker(new ConfigService(ENABLED));

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(error).toHaveBeenCalledWith(
      'Test worker failed to start',
      expect.stringContaining('bundle failed'),
    );
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('should register the task queue and workflows path, then run the post-start step', async () => {
    const { create } = startable();
    const service = new TestWorker(
      new ConfigService({ ...ENABLED, TEMPORAL_ADDRESS: 'temporal:7233' }),
    );

    service.onModuleInit();
    await vi.waitFor(() => expect(service.afterStartFn).toHaveBeenCalledTimes(1));

    expect(service.afterStartFn).toHaveBeenCalledWith('temporal:7233');
    expect(create).toHaveBeenCalledTimes(1);
    const options = create.mock.calls[0]?.[0];
    assert(options);
    expect(options.taskQueue).toBe(TASK_QUEUE);
    expect(options.workflowsPath).toBe('/workflows/test.workflow');
    await service.onModuleDestroy();
  });

  it('should keep the worker running when the post-start step fails', async () => {
    const { shutdown } = startable();
    const service = new TestWorker(new ConfigService(ENABLED));
    service.afterStartFn.mockRejectedValue(new Error('schedule rejected'));

    service.onModuleInit();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Test worker post-start step failed',
        expect.stringContaining('schedule rejected'),
      ),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('should stop the worker and close the pool and the connection on shutdown', async () => {
    const { worker, shutdown, nativeClose, poolEnd } = startable();
    const service = new TestWorker(new ConfigService(ENABLED));

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('should log a worker that stops with an error and still close its connections once', async () => {
    const { worker, nativeClose, poolEnd } = startable();
    vi.mocked(worker.run).mockRejectedValue(new Error('worker crashed'));
    const service = new TestWorker(new ConfigService(ENABLED));

    service.onModuleInit();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Test worker stopped with an error',
        expect.stringContaining('worker crashed'),
      ),
    );
    await vi.waitFor(() => expect(poolEnd).toHaveBeenCalledTimes(1));
    await service.onModuleDestroy();

    expect(nativeClose).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });
});
