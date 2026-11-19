import type { NatsConnection } from '@nats-io/nats-core';
import { Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { DrizzleDB } from '@roviq/database';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinioHealthIndicator } from '../minio.health';
import { NatsHealthIndicator } from '../nats.health';
import { PostgresHealthIndicator } from '../postgres.health';
import { PROBE_TIMEOUT_MS, runProbe } from '../probe';
import { RedisHealthIndicator } from '../redis.health';

const healthIndicatorService = new HealthIndicatorService();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('should be down without leaking the driver error into the public response', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const db = createMock<DrizzleDB>({
      execute: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    });
    const indicator = new PostgresHealthIndicator(healthIndicatorService, db);

    const result = await indicator.isHealthy();

    expect(result).toEqual({ postgres: { status: 'down' } });
    expect(warn).toHaveBeenCalledWith(
      'postgres health check failed: connect ECONNREFUSED 10.0.0.5:5432',
    );
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

    expect(result).toEqual({ redis: { status: 'down' } });
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

    expect(result).toEqual({ nats: { status: 'down' } });
  });
});

describe('MinioHealthIndicator', () => {
  function storageWith(buckets: { private: boolean; public: boolean }): FakeStorageClient {
    const storage = new FakeStorageClient();
    vi.spyOn(storage, 'bucketExists').mockImplementation(async (bucket) => buckets[bucket]);
    return storage;
  }

  it('should be up when both buckets exist', async () => {
    const indicator = new MinioHealthIndicator(
      healthIndicatorService,
      storageWith({ private: true, public: true }),
    );

    const result = await indicator.isHealthy();

    expect(result.minio.status).toBe('up');
  });

  it.each([
    ['private', { private: false, public: true }],
    ['public', { private: true, public: false }],
  ] as const)('should be down when the %s bucket is missing', async (_name, buckets) => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const indicator = new MinioHealthIndicator(healthIndicatorService, storageWith(buckets));

    const result = await indicator.isHealthy();

    expect(result).toEqual({ minio: { status: 'down' } });
  });

  it('should be down when storage cannot be reached', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const storage = new FakeStorageClient();
    vi.spyOn(storage, 'bucketExists').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const indicator = new MinioHealthIndicator(healthIndicatorService, storage);

    const result = await indicator.isHealthy();

    expect(result).toEqual({ minio: { status: 'down' } });
  });
});
