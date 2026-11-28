import { ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_ANSWER_TTL_MS, HealthController } from '../health.controller';
import { NatsHealthIndicator } from '../indicators/nats.health';
import { PostgresHealthIndicator } from '../indicators/postgres.health';
import { RedisHealthIndicator } from '../indicators/redis.health';
import { StorageHealthIndicator } from '../indicators/storage.health';
import { TemporalHealthIndicator } from '../indicators/temporal.health';

function createMockHealthCheckService() {
  return createMock<HealthCheckService>({
    check: vi.fn().mockImplementation(async (indicators: (() => Promise<unknown>)[]) => {
      const results = await Promise.all(indicators.map((fn) => fn()));
      const info = Object.assign({}, ...results);
      return { status: 'ok', info, details: info, error: {} };
    }),
  });
}

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealth: ReturnType<typeof createMockHealthCheckService>;
  let postgres: PostgresHealthIndicator;
  let redis: RedisHealthIndicator;
  let nats: NatsHealthIndicator;
  let temporal: TemporalHealthIndicator;
  let storage: StorageHealthIndicator;

  beforeEach(() => {
    mockHealth = createMockHealthCheckService();
    postgres = createMock<PostgresHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ postgres: { status: 'up' } }),
    });
    redis = createMock<RedisHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'up' } }),
    });
    nats = createMock<NatsHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ nats: { status: 'up' } }),
    });
    temporal = createMock<TemporalHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ temporal: { status: 'up' } }),
    });
    storage = createMock<StorageHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ storage: { status: 'up' } }),
    });

    controller = new HealthController(mockHealth, postgres, redis, nats, temporal, storage);
  });

  it('should answer only a status, with no dependency in it', async () => {
    expect(await controller.check()).toEqual({ status: 'ok' });
    expect(await controller.ready()).toEqual({ status: 'ok' });
  });

  it('should call each indicator exactly once per check', async () => {
    await controller.check();

    for (const indicator of [postgres, redis, nats, temporal, storage]) {
      expect(indicator.isHealthy).toHaveBeenCalledTimes(1);
    }
    expect(mockHealth.check).toHaveBeenCalledTimes(1);
  });

  it('should gate readiness only on the dependencies every request needs', async () => {
    await controller.ready();

    for (const indicator of [postgres, redis, nats]) {
      expect(indicator.isHealthy).toHaveBeenCalledTimes(1);
    }
    expect(temporal.isHealthy).not.toHaveBeenCalled();
    expect(storage.isHealthy).not.toHaveBeenCalled();
  });

  it('should reuse an answer for a few seconds, so a flood of probes costs one round of checks', async () => {
    await Promise.all([controller.check(), controller.check(), controller.check()]);
    await controller.check();

    expect(mockHealth.check).toHaveBeenCalledTimes(1);
  });

  it('should check again once the remembered answer is too old', async () => {
    vi.useFakeTimers();
    try {
      await controller.check();
      vi.advanceTimersByTime(HEALTH_ANSWER_TTL_MS + 1);
      await controller.check();
    } finally {
      vi.useRealTimers();
    }

    expect(mockHealth.check).toHaveBeenCalledTimes(2);
  });

  it('should answer 503 with no detail when a dependency is down', async () => {
    mockHealth.check.mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        error: { redis: { status: 'down', message: 'connect ECONNREFUSED 10.0.0.5:6379' } },
      }),
    );

    const failure = await controller.check().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({ status: 'error' });
  });
});
