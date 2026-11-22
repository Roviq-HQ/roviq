import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDED_WORKER_RESTART_DELAY_MS } from '@roviq/temporal';
import { NativeConnection } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { BillingWorkerService } from '../workflows/billing.worker';

describe('BillingWorkerService', () => {
  let warn: MockInstance<Logger['warn']>;

  beforeEach(() => {
    // ConfigService prefers process.env; a developer's .env must not decide the flag.
    vi.stubEnv('BILLING_WORKER_ENABLED', undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should start the billing worker again 30 s after it stops', async () => {
    const connect = vi
      .spyOn(NativeConnection, 'connect')
      .mockRejectedValue(new Error('temporal unreachable'));
    const worker = new BillingWorkerService(
      new ConfigService({
        BILLING_WORKER_ENABLED: 'true',
        DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      }),
    );

    worker.onModuleInit();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        `Billing worker will try to start again in ${EMBEDDED_WORKER_RESTART_DELAY_MS} ms`,
      ),
    );
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EMBEDDED_WORKER_RESTART_DELAY_MS);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    await worker.onModuleDestroy();
  });
});
