import type { Server } from 'node:http';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableGracefulShutdown,
  type HookOwner,
  SHUTDOWN_TIMEOUT_MS,
  type ShutdownDeps,
  shutdownGracefully,
  TELEMETRY_FLUSH_TIMEOUT_MS,
  trackLifecycleHooks,
} from '../graceful-shutdown';

function fakeDeps(owners: HookOwner[] = []) {
  const calls: string[] = [];
  const exit = vi.fn((code: number) => {
    calls.push(`exit:${code}`);
  });
  const flushTelemetry = vi.fn(async () => {
    calls.push('flushTelemetry');
  });
  const logger = createMock<LoggerService>();
  const deps: ShutdownDeps = {
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    telemetryFlushTimeoutMs: TELEMETRY_FLUSH_TIMEOUT_MS,
    exit,
    logger,
    hookOwners: () => owners,
    flushTelemetry,
  };
  return { deps, calls, exit, flushTelemetry, logger };
}

function fakeApp(calls: string[], close: () => Promise<void>, listening = true) {
  const server = createMock<Server>({
    listening,
    close: vi.fn(() => {
      calls.push('server.close');
      return server;
    }),
  });
  const app = createMock<INestApplication>({
    getHttpServer: vi.fn(() => server),
    close: vi.fn(async () => {
      calls.push('app.close');
      await close();
    }),
  });
  return { app, server };
}

const never = () => new Promise<void>(() => {});

describe('shutdownGracefully', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stop listening, close the app, flush telemetry, then exit 0', async () => {
    const { deps, calls } = fakeDeps();
    const { app } = fakeApp(calls, async () => undefined);

    await shutdownGracefully(app, 'SIGTERM', deps);

    expect(calls).toEqual(['server.close', 'app.close', 'flushTelemetry', 'exit:0']);
  });

  it('should not close an HTTP server that is not listening', async () => {
    const { deps, calls } = fakeDeps();
    const { app, server } = fakeApp(calls, async () => undefined, false);

    await shutdownGracefully(app, 'SIGINT', deps);

    expect(server.close).not.toHaveBeenCalled();
    expect(calls).toEqual(['app.close', 'flushTelemetry', 'exit:0']);
  });

  it('should exit 1 when closing the app fails, without flushing telemetry', async () => {
    const { deps, calls, logger } = fakeDeps();
    const { app } = fakeApp(calls, async () => {
      throw new Error('pool already ended');
    });

    await shutdownGracefully(app, 'SIGTERM', deps);

    expect(calls).toEqual(['server.close', 'app.close', 'exit:1']);
    expect(logger.error).toHaveBeenCalledWith(
      { err: new Error('pool already ended') },
      'Shutdown failed while closing the HTTP server and microservices',
    );
  });

  it('should log a failed telemetry flush and still exit 0 once the app closed', async () => {
    const { deps, calls, logger } = fakeDeps();
    deps.flushTelemetry = async () => {
      throw new Error('14 UNAVAILABLE: connect ECONNREFUSED');
    };
    const { app } = fakeApp(calls, async () => undefined);

    await shutdownGracefully(app, 'SIGTERM', deps);

    expect(calls).toEqual(['server.close', 'app.close', 'exit:0']);
    expect(logger.error).toHaveBeenCalledWith(
      { err: new Error('14 UNAVAILABLE: connect ECONNREFUSED') },
      'Telemetry flush failed',
    );
  });

  it('should exit 1 after the time limit and name the hook still running', async () => {
    vi.useFakeTimers();
    const stuck = { onModuleDestroy: never, onApplicationShutdown: vi.fn(async () => undefined) };
    const { deps, exit, logger, flushTelemetry } = fakeDeps([
      { name: 'AuditConsumer', instance: stuck },
    ]);
    const { app } = fakeApp([], async () => {
      await stuck.onModuleDestroy();
    });

    void shutdownGracefully(app, 'SIGTERM', deps);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);

    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(logger.error).toHaveBeenCalledWith(
      `Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS} ms; still closing: AuditConsumer.onModuleDestroy`,
    );
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(flushTelemetry).not.toHaveBeenCalled();
  });

  it('should give up on a stalled telemetry flush and still exit 0', async () => {
    vi.useFakeTimers();
    const { deps, exit, logger } = fakeDeps();
    deps.flushTelemetry = never;
    const { app } = fakeApp([], async () => undefined);

    void shutdownGracefully(app, 'SIGTERM', deps);
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_TIMEOUT_MS - 1);

    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(logger.warn).toHaveBeenCalledWith(
      `Telemetry flush did not finish within ${TELEMETRY_FLUSH_TIMEOUT_MS} ms; dropped it`,
    );
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('should name the stage when no hook is running at the time limit', async () => {
    vi.useFakeTimers();
    const { deps, exit, logger } = fakeDeps();
    const { app } = fakeApp([], never);

    void shutdownGracefully(app, 'SIGTERM', deps);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);

    expect(logger.error).toHaveBeenCalledWith(
      `Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS} ms; still closing: the HTTP server and microservices`,
    );
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('trackLifecycleHooks', () => {
  it('should list a hook while it runs and drop it once it settles', async () => {
    let finish = () => {};
    const instance = {
      value: 2,
      onApplicationShutdown(this: { value: number }, signal?: string) {
        return new Promise<string>((resolve) => {
          finish = () => resolve(`${signal}:${this.value}`);
        });
      },
    };

    const pending = trackLifecycleHooks([{ name: 'RedisModule', instance }]);
    const result = instance.onApplicationShutdown('SIGTERM');

    expect([...pending]).toEqual(['RedisModule.onApplicationShutdown']);

    finish();

    await expect(result).resolves.toBe('SIGTERM:2');
    expect(pending.size).toBe(0);
  });

  it('should drop a hook that rejects', async () => {
    const instance = { onModuleDestroy: async () => Promise.reject(new Error('boom')) };
    const pending = trackLifecycleHooks([{ name: 'DlqConsumer', instance }]);

    await expect(instance.onModuleDestroy()).rejects.toThrow('boom');
    expect(pending.size).toBe(0);
  });

  it('should skip values that are not objects and wrap a shared instance once', async () => {
    const shared = { onModuleDestroy: vi.fn(async () => undefined) };
    const pending = trackLifecycleHooks([
      { name: 'TOKEN', instance: 'a string' },
      { name: 'NULL', instance: null },
      { name: 'First', instance: shared },
      { name: 'Alias', instance: shared },
    ]);

    await shared.onModuleDestroy();

    expect(pending.size).toBe(0);
  });
});

describe('enableGracefulShutdown', () => {
  let before: Record<'SIGTERM' | 'SIGINT', ReturnType<typeof process.listeners>>;

  beforeEach(() => {
    before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
  });

  afterEach(() => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!before[signal].includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  it('should shut down once however many signals arrive', async () => {
    const { deps, exit, calls } = fakeDeps();
    const { app } = fakeApp(calls, async () => undefined);

    enableGracefulShutdown(app, deps);
    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGINT', 'SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
