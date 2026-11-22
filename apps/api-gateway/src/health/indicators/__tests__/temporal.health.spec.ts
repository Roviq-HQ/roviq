import type { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { createMock } from '@roviq/testing';
import { Connection } from '@temporalio/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemporalHealthIndicator } from '../temporal.health';

const healthIndicatorService = new HealthIndicatorService();

function configWith(values: Record<string, string>): ConfigService {
  return createMock<ConfigService>({ get: vi.fn((key: string) => values[key]) });
}

function lazyConnectionReturning(status: number) {
  const check = vi.fn().mockResolvedValue({ status });
  const connection = createMock<Connection>({
    healthService: createMock<Connection['healthService']>({ check }),
    withDeadline: vi.fn((_deadline: number | Date, fn: () => Promise<unknown>) => fn()),
    close: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(Connection, 'lazy').mockReturnValue(connection);
  return { connection, check };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TemporalHealthIndicator', () => {
  it('should be up when the gRPC health service answers SERVING', async () => {
    const { check } = lazyConnectionReturning(1);
    const indicator = new TemporalHealthIndicator(
      healthIndicatorService,
      configWith({ TEMPORAL_ADDRESS: 'temporal.test:7233' }),
    );

    const result = await indicator.isHealthy();

    expect(result.temporal.status).toBe('up');
    expect(Connection.lazy).toHaveBeenCalledWith({ address: 'temporal.test:7233' });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('should reuse one connection across checks', async () => {
    const { check } = lazyConnectionReturning(1);
    const indicator = new TemporalHealthIndicator(
      healthIndicatorService,
      configWith({ TEMPORAL_ADDRESS: 'temporal.test:7233' }),
    );

    await indicator.isHealthy();
    await indicator.isHealthy();

    expect(Connection.lazy).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('should be down when the health service answers NOT_SERVING', async () => {
    lazyConnectionReturning(2);
    const indicator = new TemporalHealthIndicator(
      healthIndicatorService,
      configWith({ TEMPORAL_ADDRESS: 'temporal.test:7233' }),
    );

    const result = await indicator.isHealthy();

    expect(result).toEqual({ temporal: { status: 'down' } });
  });

  it('should be down when TEMPORAL_ADDRESS is unset', async () => {
    vi.spyOn(Connection, 'lazy');
    const indicator = new TemporalHealthIndicator(healthIndicatorService, configWith({}));

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      temporal: { status: 'down' },
    });
    expect(Connection.lazy).not.toHaveBeenCalled();
  });

  it('should close the connection on application shutdown', async () => {
    const { connection } = lazyConnectionReturning(1);
    const indicator = new TemporalHealthIndicator(
      healthIndicatorService,
      configWith({ TEMPORAL_ADDRESS: 'temporal.test:7233' }),
    );

    await indicator.onApplicationShutdown();

    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
