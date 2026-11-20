import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeStorageClient } from '@roviq/storage';
import { NativeConnection } from '@temporalio/worker';
import { describe, expect, it, vi } from 'vitest';
import { FileSweeperWorkerService } from '../file-sweeper.worker';

function configWith(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

describe('FileSweeperWorkerService', () => {
  it('should not connect to Temporal when the flag is off', () => {
    const connect = vi.spyOn(NativeConnection, 'connect');
    const service = new FileSweeperWorkerService(configWith({}), new FakeStorageClient());

    service.onModuleInit();

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

  it('should log, not throw, when the worker cannot start', async () => {
    vi.spyOn(NativeConnection, 'connect').mockRejectedValue(new Error('temporal unreachable'));
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new FileSweeperWorkerService(
      configWith({
        FILE_SWEEPER_WORKER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      }),
      new FakeStorageClient(),
    );

    expect(() => service.onModuleInit()).not.toThrow();

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'File sweeper worker failed to start',
        expect.stringContaining('temporal unreachable'),
      ),
    );
  });
});
