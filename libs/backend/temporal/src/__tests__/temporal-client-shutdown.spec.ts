import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TemporalClientService } from '../temporal-client.service';

// Nothing listens here, so every call is answered UNAVAILABLE and the client keeps retrying.
const NO_SERVER = '127.0.0.1:1';

describe('TemporalClientService shutdown', () => {
  const uncaught: unknown[] = [];
  const record = (error: unknown): void => {
    uncaught.push(error);
  };

  beforeEach(() => {
    uncaught.length = 0;
    process.on('uncaughtException', record);
  });

  afterEach(() => {
    process.off('uncaughtException', record);
  });

  it('should end a call that is still retrying, and leave no retry behind to fail later', async () => {
    const config = { get: () => NO_SERVER } as unknown as ConfigService;
    const service = new TemporalClientService(config);
    const pending = service
      .startWorkflow('NoSuchWorkflow', { taskQueue: 'none', workflowId: 'shutdown-spec' })
      .then(
        () => 'started',
        () => 'refused',
      );
    // Long enough for the first attempt to fail and a retry to be scheduled.
    await new Promise((resolve) => setTimeout(resolve, 300));

    await service.onApplicationShutdown();

    expect(await pending).toBe('refused');
    // A retry scheduled before the close would fire within its back-off.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(uncaught).toEqual([]);
  }, 20_000);
});
