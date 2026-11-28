import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TemporalHealthIndicator } from '../temporal.health';

// Nothing listens here, so the probe is answered "unavailable".
const NO_SERVER = '127.0.0.1:1';

describe('TemporalHealthIndicator shutdown', () => {
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

  it('should report down for an unreachable server and leave nothing running after it closes', async () => {
    const indicator = new TemporalHealthIndicator(
      new HealthIndicatorService(),
      new ConfigService({ TEMPORAL_ADDRESS: NO_SERVER }),
    );
    const probe = indicator.probe();
    // Long enough for the first attempt to be refused.
    await new Promise((resolve) => setTimeout(resolve, 300));

    await indicator.onApplicationShutdown();

    expect((await probe).up).toBe(false);
    // A retry scheduled before the close would fire within its back-off and throw.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(uncaught).toEqual([]);
  }, 20_000);
});
