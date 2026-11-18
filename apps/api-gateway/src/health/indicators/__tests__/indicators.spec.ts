import type { NatsConnection } from '@nats-io/nats-core';
import type { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { DrizzleDB } from '@roviq/database';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinioHealthIndicator } from '../minio.health';
import { NatsHealthIndicator } from '../nats.health';
import { PostgresHealthIndicator } from '../postgres.health';
import { PROBE_TIMEOUT_MS, runProbe } from '../probe';
import { RedisHealthIndicator } from '../redis.health';

const healthIndicatorService = new HealthIndicatorService();

function configWith(values: Record<string, string>): ConfigService {
  return createMock<ConfigService>({ get: vi.fn((key: string) => values[key]) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runProbe', () => {
  it('should report up with a non-negative response time when the check resolves', async () => {
    const result = await runProbe(async () => undefined);

    expect(result.up).toBe(true);
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('should report down with the error message when the check rejects', async () => {
    const result = await runProbe(async () => {
      throw new Error('connection refused');
    });

    expect(result.up).toBe(false);
    expect(result.error).toBe('connection refused');
  });

  it('should report down when the check outlives the timeout', async () => {
    vi.useFakeTimers();
    const pending = runProbe(() => new Promise<void>(() => undefined));

    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    const result = await pending;

    expect(result.up).toBe(false);
    expect(result.error).toBe(`timed out after ${PROBE_TIMEOUT_MS}ms`);
  });
});

describe('PostgresHealthIndicator', () => {
  it('should be up when SELECT 1 succeeds', async () => {
    const db = createMock<DrizzleDB>({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
    const indicator = new PostgresHealthIndicator(healthIndicatorService, db);

    const result = await indicator.isHealthy();

    expect(result.postgres.status).toBe('up');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('should be down with the driver error when the query fails', async () => {
    const db = createMock<DrizzleDB>({
      execute: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const indicator = new PostgresHealthIndicator(healthIndicatorService, db);

    const result = await indicator.isHealthy();

    expect(result).toEqual({ postgres: { status: 'down', message: 'ECONNREFUSED' } });
  });
});

describe('RedisHealthIndicator', () => {
  it('should be up when PING succeeds', async () => {
    const redis = createMock<Redis>({ ping: vi.fn().mockResolvedValue('PONG') });
    const indicator = new RedisHealthIndicator(healthIndicatorService, redis);

    const result = await indicator.isHealthy();

    expect(result.redis.status).toBe('up');
  });

  it('should be down when PING fails', async () => {
    const redis = createMock<Redis>({ ping: vi.fn().mockRejectedValue(new Error('closed')) });
    const indicator = new RedisHealthIndicator(healthIndicatorService, redis);

    const result = await indicator.isHealthy();

    expect(result).toEqual({ redis: { status: 'down', message: 'closed' } });
  });
});

describe('NatsHealthIndicator', () => {
  it('should be up when a round trip to the server succeeds', async () => {
    const nc = createMock<NatsConnection>({ rtt: vi.fn().mockResolvedValue(3) });
    const indicator = new NatsHealthIndicator(healthIndicatorService, nc);

    const result = await indicator.isHealthy();

    expect(result.nats.status).toBe('up');
    expect(nc.rtt).toHaveBeenCalledTimes(1);
  });

  it('should be down when the connection is closed', async () => {
    const nc = createMock<NatsConnection>({
      rtt: vi.fn().mockRejectedValue(new Error('CONNECTION_CLOSED')),
    });
    const indicator = new NatsHealthIndicator(healthIndicatorService, nc);

    const result = await indicator.isHealthy();

    expect(result).toEqual({ nats: { status: 'down', message: 'CONNECTION_CLOSED' } });
  });
});

describe('MinioHealthIndicator', () => {
  it('should call the MinIO liveness endpoint under S3_ENDPOINT and be up on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const indicator = new MinioHealthIndicator(
      healthIndicatorService,
      configWith({ S3_ENDPOINT: 'http://minio.test:9000' }),
    );

    const result = await indicator.isHealthy();

    expect(result.minio.status).toBe('up');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio.test:9000/minio/health/live',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should be down on a non-2xx liveness answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const indicator = new MinioHealthIndicator(
      healthIndicatorService,
      configWith({ S3_ENDPOINT: 'http://minio.test:9000' }),
    );

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      minio: { status: 'down', message: 'MinIO liveness returned HTTP 503' },
    });
  });

  it('should be down without calling anything when S3_ENDPOINT is unset', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const indicator = new MinioHealthIndicator(healthIndicatorService, configWith({}));

    const result = await indicator.isHealthy();

    expect(result).toEqual({ minio: { status: 'down', message: 'S3_ENDPOINT is not configured' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
