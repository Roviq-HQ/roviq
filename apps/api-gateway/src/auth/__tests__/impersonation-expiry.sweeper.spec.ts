import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImpersonationService } from '../impersonation.service';
import { ImpersonationExpirySweeper } from '../impersonation-expiry.sweeper';

describe('ImpersonationExpirySweeper', () => {
  let service: ImpersonationService;
  let sweeper: ImpersonationExpirySweeper;

  beforeEach(() => {
    vi.useFakeTimers();
    service = createMock<ImpersonationService>({
      expireOverdueSessions: vi.fn().mockResolvedValue(0),
    });
    sweeper = new ImpersonationExpirySweeper(service);
  });

  afterEach(() => {
    sweeper.onModuleDestroy();
    vi.useRealTimers();
  });

  it('should sweep every minute, not at boot', async () => {
    sweeper.onModuleInit();
    expect(service.expireOverdueSessions).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.expireOverdueSessions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.expireOverdueSessions).toHaveBeenCalledTimes(2);
  });

  it('should keep sweeping after a failed sweep', async () => {
    vi.mocked(service.expireOverdueSessions).mockRejectedValueOnce(new Error('db down'));
    sweeper.onModuleInit();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(service.expireOverdueSessions).toHaveBeenCalledTimes(2);
  });

  it('should stop sweeping once destroyed', async () => {
    sweeper.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    sweeper.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(180_000);

    expect(service.expireOverdueSessions).toHaveBeenCalledTimes(1);
  });
});
