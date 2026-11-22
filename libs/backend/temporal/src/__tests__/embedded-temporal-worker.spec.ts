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

  constructor(config: ConfigService, restartDelayMs?: number) {
    super(config, {
      flag: FLAG,
      label: 'Test worker',
      taskQueue: TASK_QUEUE,
      loggerName: TestWorker.name,
      restartDelayMs,
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
  let log: MockInstance<Logger['log']>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(log).toHaveBeenLastCalledWith('Test worker stopped');
  });

  it('should not log a stop for a worker that never ran', async () => {
    const service = new TestWorker(new ConfigService({}));

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(log).not.toHaveBeenCalled();
  });

  describe('workerStatus', () => {
    it('should be disabled when the flag is off', () => {
      const service = new TestWorker(new ConfigService({}));

      service.onModuleInit();

      expect(service.workerStatus).toBe('disabled');
    });

    it('should be starting until the worker is created, then running', async () => {
      startable();
      let release = () => {};
      vi.mocked(NativeConnection.connect).mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve(createMock<NativeConnection>({ close: vi.fn(async () => {}) }));
          }),
      );
      const service = new TestWorker(new ConfigService(ENABLED));

      service.onModuleInit();
      expect(service.workerStatus).toBe('starting');
      release();

      await vi.waitFor(() => expect(service.workerStatus).toBe('running'));
      await service.onModuleDestroy();
    });

    it('should be stopped when the worker cannot start', async () => {
      vi.spyOn(NativeConnection, 'connect').mockRejectedValue(new Error('temporal unreachable'));
      vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
      const service = new TestWorker(new ConfigService(ENABLED));

      service.onModuleInit();
      await service.onModuleDestroy();

      expect(service.workerStatus).toBe('stopped');
    });

    it('should be stopped when a running worker crashes', async () => {
      const { worker } = startable();
      vi.mocked(worker.run).mockRejectedValue(new Error('worker crashed'));
      const service = new TestWorker(new ConfigService(ENABLED));

      service.onModuleInit();

      await vi.waitFor(() => expect(service.workerStatus).toBe('stopped'));
      await service.onModuleDestroy();
    });

    it('should be stopped after shutdown', async () => {
      startable();
      const service = new TestWorker(new ConfigService(ENABLED));

      service.onModuleInit();
      await service.onModuleDestroy();

      expect(service.workerStatus).toBe('stopped');
    });
  });

  describe('restart after a stop', () => {
    const DELAY = 1_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('should start again after a failed start and end running', async () => {
      startable();
      vi.mocked(NativeConnection.connect).mockRejectedValueOnce(new Error('temporal unreachable'));
      const service = new TestWorker(new ConfigService(ENABLED), DELAY);

      service.onModuleInit();
      await vi.waitFor(() => expect(service.workerStatus).toBe('stopped'));
      expect(NativeConnection.connect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DELAY);

      await vi.waitFor(() => expect(service.workerStatus).toBe('running'));
      expect(NativeConnection.connect).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      await service.onModuleDestroy();
    });

    it('should start again when run() ends with an error', async () => {
      const { worker, create } = startable();
      vi.mocked(worker.run).mockRejectedValueOnce(new Error('worker crashed'));
      const service = new TestWorker(new ConfigService(ENABLED), DELAY);

      service.onModuleInit();
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'Test worker stopped with an error',
          expect.stringContaining('worker crashed'),
        ),
      );
      await vi.waitFor(() => expect(service.workerStatus).toBe('stopped'));

      await vi.advanceTimersByTimeAsync(DELAY);

      await vi.waitFor(() => expect(service.workerStatus).toBe('running'));
      expect(create).toHaveBeenCalledTimes(2);
      await service.onModuleDestroy();
    });

    it('should start nothing when shut down during the delay, and leave nothing open', async () => {
      const { create, nativeClose, poolEnd } = startable();
      vi.mocked(Worker.create).mockRejectedValue(new Error('bundle failed'));
      const service = new TestWorker(new ConfigService(ENABLED), DELAY);

      service.onModuleInit();
      await vi.waitFor(() => expect(service.workerStatus).toBe('stopped'));
      await service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(DELAY * 5);

      expect(create).toHaveBeenCalledTimes(1);
      expect(NativeConnection.connect).toHaveBeenCalledTimes(1);
      expect(nativeClose).toHaveBeenCalledTimes(1);
      expect(poolEnd).toHaveBeenCalledTimes(1);
      expect(service.workerStatus).toBe('stopped');
    });

    it('should not start again when the worker does not opt in', async () => {
      startable();
      vi.mocked(NativeConnection.connect).mockRejectedValue(new Error('temporal unreachable'));
      const service = new TestWorker(new ConfigService(ENABLED));

      service.onModuleInit();
      await vi.waitFor(() => expect(service.workerStatus).toBe('stopped'));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(NativeConnection.connect).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
      await service.onModuleDestroy();
    });
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
