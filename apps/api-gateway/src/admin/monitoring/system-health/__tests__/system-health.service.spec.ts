import type { NatsConnection } from '@nats-io/nats-core';
import { pubSub } from '@roviq/pubsub';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import type { ChainableCommander } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { DlqService } from '../../../../dlq/dlq.service';
import type { MinioHealthIndicator } from '../../../../health/indicators/minio.health';
import type { NatsHealthIndicator } from '../../../../health/indicators/nats.health';
import type { PostgresHealthIndicator } from '../../../../health/indicators/postgres.health';
import type { ProbeResult } from '../../../../health/indicators/probe';
import type { RedisHealthIndicator } from '../../../../health/indicators/redis.health';
import type { TemporalHealthIndicator } from '../../../../health/indicators/temporal.health';
import { ConnectionTracker } from '../../connections/connection-tracker';
import {
  type PromAlert,
  type PrometheusClient,
  PrometheusUnavailableError,
} from '../../prometheus.client';
import {
  SYSTEM_HEALTH_POLL_INTERVAL_MS,
  SYSTEM_HEALTH_UPDATED_TOPIC,
  UPTIME_BUCKET_SECONDS,
} from '../system-health.constants';
import {
  classifyProbe,
  computeUptimePercent,
  healthFingerprint,
  type SystemHealth,
  SystemHealthService,
  toActiveAlert,
  uptimeBucket,
  uptimeKey,
} from '../system-health.service';

const jsm = vi.hoisted(() => ({
  streams: [] as Array<{ name: string; pending: number[] }>,
}));

vi.mock('@nats-io/jetstream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nats-io/jetstream')>()),
  jetstreamManager: vi.fn(async () => ({
    streams: {
      list: () =>
        (async function* () {
          for (const s of jsm.streams) yield { config: { name: s.name } };
        })(),
    },
    consumers: {
      list: (stream: string) =>
        (async function* () {
          for (const pending of jsm.streams.find((s) => s.name === stream)?.pending ?? []) {
            yield { num_pending: pending };
          }
        })(),
    },
  })),
}));

const UP: ProbeResult = { up: true, responseMs: 5 };
const DOWN: ProbeResult = { up: false, responseMs: 2_000, error: 'timed out' };

/** In-memory Redis hashes behind a pipeline mock, enough for HINCRBY/EXPIRE/HMGET. */
function fakeRedis() {
  const hashes = new Map<string, Map<string, number>>();
  const pipeline = (): ChainableCommander => {
    const ops: Array<() => unknown> = [];
    const p: ChainableCommander = createMock<ChainableCommander>({
      hincrby: vi.fn((key: string, field: string, by: number) => {
        ops.push(() => {
          const hash = hashes.get(key) ?? new Map<string, number>();
          hash.set(field, (hash.get(field) ?? 0) + by);
          hashes.set(key, hash);
          return hash.get(field);
        });
        return p;
      }),
      expire: vi.fn(() => {
        ops.push(() => 1);
        return p;
      }),
      hmget: vi.fn((key: string | Buffer, ...fields: Array<string | Buffer>) => {
        ops.push(() =>
          fields.map((f) => hashes.get(String(key))?.get(String(f))?.toString() ?? null),
        );
        return p;
      }),
      exec: vi.fn(async () => ops.map((op): [Error | null, unknown] => [null, op()])),
    });
    return p;
  };
  return { redis: createMock<Redis>({ pipeline: vi.fn(pipeline) }), hashes };
}

function firing(name: string, severity: string, activeAt: string): PromAlert {
  return {
    labels: { alertname: name, severity },
    annotations: { summary: `${name} summary` },
    state: 'firing',
    activeAt,
  };
}

describe('pure helpers', () => {
  describe('classifyProbe', () => {
    it('should be DOWN when the probe failed', () => {
      expect(classifyProbe('POSTGRES', DOWN)).toBe('DOWN');
    });

    it('should be DEGRADED when reachable but over the per-service threshold', () => {
      expect(classifyProbe('POSTGRES', { up: true, responseMs: 501 })).toBe('DEGRADED');
      expect(classifyProbe('API_GATEWAY', { up: true, responseMs: 201 })).toBe('DEGRADED');
    });

    it('should be HEALTHY at or under the threshold', () => {
      expect(classifyProbe('POSTGRES', { up: true, responseMs: 500 })).toBe('HEALTHY');
    });
  });

  describe('computeUptimePercent', () => {
    it('should be null before any sample exists', () => {
      expect(computeUptimePercent([{ up: 0, total: 0 }])).toBeNull();
    });

    it('should sum samples across buckets', () => {
      expect(
        computeUptimePercent([
          { up: 2, total: 2 },
          { up: 1, total: 2 },
        ]),
      ).toBe(75);
    });
  });

  describe('uptime keys', () => {
    it('should bucket by the hour under the REDIS_KEYS prefix', () => {
      const at = new Date('2026-11-18T07:59:59Z');
      const bucket = uptimeBucket(at);

      expect(bucket % UPTIME_BUCKET_SECONDS).toBe(0);
      expect(bucket).toBe(Date.parse('2026-11-18T07:00:00Z') / 1000);
      expect(uptimeKey('REDIS', bucket)).toBe(`monitoring:uptime:REDIS:${bucket}`);
    });
  });

  describe('toActiveAlert', () => {
    it('should map severity labels and prefer the summary annotation', () => {
      expect(toActiveAlert(firing('NatsDown', 'critical', '2026-11-18T07:00:00Z'))).toEqual({
        name: 'NatsDown',
        severity: 'CRITICAL',
        message: 'NatsDown summary',
        since: new Date('2026-11-18T07:00:00Z'),
      });
    });

    it('should fall back to INFO and the alert name', () => {
      expect(
        toActiveAlert({
          labels: { alertname: 'Odd', severity: 'page' },
          annotations: {},
          state: 'firing',
          activeAt: '2026-11-18T07:00:00Z',
        }),
      ).toEqual({
        name: 'Odd',
        severity: 'INFO',
        message: 'Odd',
        since: new Date('2026-11-18T07:00:00Z'),
      });
    });
  });

  describe('healthFingerprint', () => {
    const base: SystemHealth = {
      services: [
        {
          name: 'POSTGRES',
          status: 'HEALTHY',
          responseMs: 3,
          uptimePercent: 100,
          checkedAt: new Date(1),
        },
      ],
      natsStreams: [{ name: 'AUDIT', consumerLag: 0 }],
      connections: { websocket: 1, http: 1 },
      alerts: [],
      alertsAvailable: true,
      dlqPendingCount: 0,
      checkedAt: new Date(1),
    };

    it('should ignore latency, uptime, connections and timestamps', () => {
      const noisy: SystemHealth = {
        ...base,
        services: [
          {
            ...base.services[0],
            name: 'POSTGRES',
            status: 'HEALTHY',
            responseMs: 90,
            uptimePercent: 99,
            checkedAt: new Date(2),
          },
        ],
        connections: { websocket: 9, http: 4 },
        checkedAt: new Date(2),
      };

      expect(healthFingerprint(noisy)).toBe(healthFingerprint(base));
    });

    it('should change with status, stream lag, alerts and DLQ count', () => {
      const fp = healthFingerprint(base);

      expect(
        healthFingerprint({
          ...base,
          services: [
            {
              ...base.services[0],
              name: 'POSTGRES',
              status: 'DOWN',
              responseMs: null,
              uptimePercent: 100,
              checkedAt: new Date(1),
            },
          ],
        }),
      ).not.toBe(fp);
      expect(
        healthFingerprint({ ...base, natsStreams: [{ name: 'AUDIT', consumerLag: 3 }] }),
      ).not.toBe(fp);
      expect(healthFingerprint({ ...base, alertsAvailable: false })).not.toBe(fp);
      expect(healthFingerprint({ ...base, dlqPendingCount: 1 })).not.toBe(fp);
    });
  });
});

describe('SystemHealthService', () => {
  let postgres: PostgresHealthIndicator;
  let redisIndicator: RedisHealthIndicator;
  let nats: NatsHealthIndicator;
  let temporal: TemporalHealthIndicator;
  let minio: MinioHealthIndicator;
  let prometheus: PrometheusClient;
  let dlq: DlqService;
  let connections: ConnectionTracker;
  let redis: ReturnType<typeof fakeRedis>;
  let service: SystemHealthService;
  let publish: MockInstance<typeof pubSub.publish>;

  beforeEach(() => {
    jsm.streams = [
      { name: 'NOTIFICATION', pending: [2, 3] },
      { name: 'AUDIT', pending: [] },
    ];
    postgres = createMock<PostgresHealthIndicator>({ probe: vi.fn().mockResolvedValue(UP) });
    redisIndicator = createMock<RedisHealthIndicator>({ probe: vi.fn().mockResolvedValue(UP) });
    nats = createMock<NatsHealthIndicator>({ probe: vi.fn().mockResolvedValue(UP) });
    temporal = createMock<TemporalHealthIndicator>({ probe: vi.fn().mockResolvedValue(UP) });
    minio = createMock<MinioHealthIndicator>({ probe: vi.fn().mockResolvedValue(DOWN) });
    prometheus = createMock<PrometheusClient>({
      alerts: vi
        .fn()
        .mockResolvedValue([
          firing('DlqMessages', 'warning', '2026-11-18T07:00:00Z'),
          { ...firing('Pending', 'critical', '2026-11-18T06:00:00Z'), state: 'pending' },
        ]),
    });
    dlq = createMock<DlqService>({ countPending: vi.fn().mockResolvedValue(4) });
    connections = new ConnectionTracker();
    connections.websocketOpened();
    connections.httpStarted();
    redis = fakeRedis();
    publish = vi.spyOn(pubSub, 'publish').mockResolvedValue(undefined);
    service = new SystemHealthService(
      postgres,
      redisIndicator,
      nats,
      temporal,
      minio,
      redis.redis,
      createMock<NatsConnection>(),
      prometheus,
      dlq,
      connections,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('should report all six services in MonitoredService order', async () => {
    const health = await service.getSystemHealth();

    expect(health.services.map((s) => [s.name, s.status])).toEqual([
      ['API_GATEWAY', 'HEALTHY'],
      ['POSTGRES', 'HEALTHY'],
      ['REDIS', 'HEALTHY'],
      ['NATS', 'HEALTHY'],
      ['TEMPORAL', 'HEALTHY'],
      ['MINIO', 'DOWN'],
    ]);
  });

  it('should null responseMs for a DOWN service and keep it for an up one', async () => {
    const health = await service.getSystemHealth();

    expect(health.services.find((s) => s.name === 'MINIO')?.responseMs).toBeNull();
    expect(health.services.find((s) => s.name === 'POSTGRES')?.responseMs).toBe(5);
  });

  it('should compute rolling uptime from the samples it records', async () => {
    await service.poll();
    vi.mocked(postgres.probe).mockResolvedValue(DOWN);
    await service.poll();

    const health = await service.getSystemHealth();

    expect(health.services.find((s) => s.name === 'POSTGRES')?.uptimePercent).toBe(50);
    expect(health.services.find((s) => s.name === 'MINIO')?.uptimePercent).toBe(0);
    expect(health.services.find((s) => s.name === 'REDIS')?.uptimePercent).toBe(100);
  });

  it('should sum consumer pending per stream, sorted by name', async () => {
    const health = await service.getSystemHealth();

    expect(health.natsStreams).toEqual([
      { name: 'AUDIT', consumerLag: 0 },
      { name: 'NOTIFICATION', consumerLag: 5 },
    ]);
  });

  it('should skip stream lag when NATS is down', async () => {
    vi.mocked(nats.probe).mockResolvedValue(DOWN);

    const health = await service.getSystemHealth();

    expect(health.natsStreams).toEqual([]);
  });

  it('should list only firing alerts', async () => {
    const health = await service.getSystemHealth();

    expect(health.alertsAvailable).toBe(true);
    expect(health.alerts).toEqual([
      {
        name: 'DlqMessages',
        severity: 'WARNING',
        message: 'DlqMessages summary',
        since: new Date('2026-11-18T07:00:00Z'),
      },
    ]);
  });

  it('should mark alerts unavailable (not "all clear") when Prometheus is down', async () => {
    vi.mocked(prometheus.alerts).mockRejectedValue(new PrometheusUnavailableError('down'));

    const health = await service.getSystemHealth();

    expect(health.alertsAvailable).toBe(false);
    expect(health.alerts).toEqual([]);
  });

  it('should report the pending DLQ count and live connections', async () => {
    const health = await service.getSystemHealth();

    expect(health.dlqPendingCount).toBe(4);
    expect(health.connections).toEqual({ websocket: 1, http: 1 });
  });

  it('should serve a snapshot younger than one poll interval without re-probing', async () => {
    await service.getSystemHealth();
    await service.getSystemHealth();

    expect(postgres.probe).toHaveBeenCalledTimes(1);
  });

  it('should publish the first snapshot and then only on change', async () => {
    await service.poll();
    await service.poll();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(SYSTEM_HEALTH_UPDATED_TOPIC, {
      adminSystemHealthUpdated: expect.objectContaining({ dlqPendingCount: 4 }),
    });

    vi.mocked(dlq.countPending).mockResolvedValue(5);
    await service.poll();

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should yield the current snapshot first when watched', async () => {
    const stream = service.watch();

    const first = await stream.next();

    expect(first.done).toBe(false);
    expect(first.value?.adminSystemHealthUpdated.services).toHaveLength(6);
    await stream.return(undefined);
  });

  it('should poll on the interval and stop after module destroy', async () => {
    vi.useFakeTimers();
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(postgres.probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SYSTEM_HEALTH_POLL_INTERVAL_MS);
    expect(postgres.probe).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(SYSTEM_HEALTH_POLL_INTERVAL_MS * 2);
    expect(postgres.probe).toHaveBeenCalledTimes(2);
  });

  it('should keep polling when a dependency throws unexpectedly', async () => {
    vi.mocked(dlq.countPending).mockRejectedValue(new Error('boom'));

    const health = await service.getSystemHealth();

    expect(health.dlqPendingCount).toBe(0);
  });
});
