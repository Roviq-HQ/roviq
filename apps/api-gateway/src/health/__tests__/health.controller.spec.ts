import { HealthCheckService } from '@nestjs/terminus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../health.controller';
import { MinioHealthIndicator } from '../indicators/minio.health';
import { NatsHealthIndicator } from '../indicators/nats.health';
import { PostgresHealthIndicator } from '../indicators/postgres.health';
import { RedisHealthIndicator } from '../indicators/redis.health';
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
  let minio: MinioHealthIndicator;

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
    minio = createMock<MinioHealthIndicator>({
      isHealthy: vi.fn().mockResolvedValue({ minio: { status: 'up' } }),
    });

    controller = new HealthController(mockHealth, postgres, redis, nats, temporal, minio);
  });

  it('should report every platform dependency', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.info).toEqual({
      postgres: { status: 'up' },
      redis: { status: 'up' },
      nats: { status: 'up' },
      temporal: { status: 'up' },
      minio: { status: 'up' },
    });
  });

  it('should call each indicator exactly once per check', async () => {
    await controller.check();

    for (const indicator of [postgres, redis, nats, temporal, minio]) {
      expect(indicator.isHealthy).toHaveBeenCalledTimes(1);
    }
    expect(mockHealth.check).toHaveBeenCalledTimes(1);
  });

  it('should gate readiness only on the dependencies every request needs', async () => {
    const result = await controller.ready();

    expect(result.info).toEqual({
      postgres: { status: 'up' },
      redis: { status: 'up' },
      nats: { status: 'up' },
    });
    expect(temporal.isHealthy).not.toHaveBeenCalled();
    expect(minio.isHealthy).not.toHaveBeenCalled();
  });
});
