import { type IntervalHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import { type JetStreamManager, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AlertSeverity,
  MONITORED_SERVICE_VALUES,
  type MonitoredService,
  type ServiceHealthStatus,
} from '@roviq/common-types';
import { pubSub } from '@roviq/pubsub';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { REDIS_KEYS } from '../../../auth/redis-keys';
import { DlqService } from '../../../dlq/dlq.service';
import { DLQ_NATS_CONNECTION } from '../../../dlq/dlq-nats.provider';
import { NatsHealthIndicator } from '../../../health/indicators/nats.health';
import { PostgresHealthIndicator } from '../../../health/indicators/postgres.health';
import type { ProbeResult } from '../../../health/indicators/probe';
import { RedisHealthIndicator } from '../../../health/indicators/redis.health';
import { StorageHealthIndicator } from '../../../health/indicators/storage.health';
import { TemporalHealthIndicator } from '../../../health/indicators/temporal.health';
import { type ConnectionCounts, ConnectionTracker } from '../connections/connection-tracker';
import { type FiringAlert, OpenObserveClient } from '../openobserve.client';
import {
  DEGRADED_THRESHOLD_MS,
  SYSTEM_HEALTH_POLL_INTERVAL_MS,
  SYSTEM_HEALTH_UPDATED_TOPIC,
  UPTIME_BUCKET_SECONDS,
  UPTIME_BUCKET_TTL_SECONDS,
  UPTIME_WINDOW_BUCKETS,
} from './system-health.constants';

export interface ServiceHealth {
  name: MonitoredService;
  status: ServiceHealthStatus;
  responseMs: number | null;
  uptimePercent: number | null;
  checkedAt: Date;
}

export interface NatsStreamLag {
  name: string;
  consumerLag: number;
}

export interface ActiveAlert {
  name: string;
  severity: AlertSeverity;
  message: string;
  since: Date;
}

export interface SystemHealth {
  services: ServiceHealth[];
  natsStreams: NatsStreamLag[];
  connections: ConnectionCounts;
  alerts: ActiveAlert[];
  alertsAvailable: boolean;
  dlqPendingCount: number;
  checkedAt: Date;
}

export interface SystemHealthUpdatedPayload {
  adminSystemHealthUpdated: SystemHealth;
}

const NANOS_PER_MS = 1_000_000;

export function classifyProbe(service: MonitoredService, probe: ProbeResult): ServiceHealthStatus {
  if (!probe.up) return 'DOWN';
  return probe.responseMs > DEGRADED_THRESHOLD_MS[service] ? 'DEGRADED' : 'HEALTHY';
}

export function uptimeBucket(at: Date): number {
  return Math.floor(at.getTime() / 1000 / UPTIME_BUCKET_SECONDS) * UPTIME_BUCKET_SECONDS;
}

export function uptimeKey(service: MonitoredService, bucket: number): string {
  return `${REDIS_KEYS.SYSTEM_HEALTH_UPTIME}${service}:${bucket}`;
}

/** Percentage of `up` samples over the summed buckets; null when nothing was sampled yet. */
export function computeUptimePercent(buckets: Array<{ up: number; total: number }>): number | null {
  let up = 0;
  let total = 0;
  for (const b of buckets) {
    up += b.up;
    total += b.total;
  }
  return total === 0 ? null : (up / total) * 100;
}

export function toAlertSeverity(label: string | undefined): AlertSeverity {
  switch (label?.toLowerCase()) {
    // `page` and `ticket`: the notification alerts name who acts and how fast (ROV-329).
    case 'critical':
    case 'page':
      return 'CRITICAL';
    case 'warning':
    case 'ticket':
      return 'WARNING';
    default:
      return 'INFO';
  }
}

export function toActiveAlert(alert: FiringAlert): ActiveAlert {
  const name = alert.labels.alertname ?? 'unknown';
  return {
    name,
    severity: toAlertSeverity(alert.labels.severity),
    message: alert.annotations.summary ?? alert.annotations.description ?? name,
    since: new Date(alert.activeAt),
  };
}

/** What subscribers care about: latency, uptime, connections and timestamps change every poll and are excluded. */
export function healthFingerprint(snapshot: SystemHealth): string {
  return JSON.stringify({
    services: snapshot.services.map((s) => [s.name, s.status]),
    streams: snapshot.natsStreams.map((s) => [s.name, s.consumerLag]),
    alerts: snapshot.alerts.map((a) => [a.name, a.severity]).sort(),
    alertsAvailable: snapshot.alertsAvailable,
    dlq: snapshot.dlqPendingCount,
  });
}

@Injectable()
export class SystemHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthService.name);
  private readonly loopDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout | null = null;
  private latest: SystemHealth | null = null;
  private lastFingerprint: string | null = null;
  private inflight: Promise<SystemHealth> | null = null;
  private jsm: Promise<JetStreamManager> | null = null;

  constructor(
    private readonly postgres: PostgresHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly nats: NatsHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
    private readonly storage: StorageHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly openObserve: OpenObserveClient,
    private readonly dlq: DlqService,
    private readonly connections: ConnectionTracker,
  ) {}

  onModuleInit(): void {
    this.loopDelay.enable();
    this.timer = setInterval(() => void this.poll(), SYSTEM_HEALTH_POLL_INTERVAL_MS);
    // Never keep the process (or a test runner) alive just for the poller.
    this.timer.unref();
    // No poll at boot: every integration app boots this module, and a probe each
    // exhausts the shared test Postgres. getSystemHealth() checks on demand.
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loopDelay.disable();
  }

  /** Latest snapshot when it is younger than one poll interval, otherwise a fresh check. */
  async getSystemHealth(): Promise<SystemHealth> {
    const latest = this.latest;
    if (latest && Date.now() - latest.checkedAt.getTime() < SYSTEM_HEALTH_POLL_INTERVAL_MS) {
      return { ...latest, connections: this.connections.snapshot() };
    }
    return this.refresh();
  }

  getConnectionStats(): ConnectionCounts {
    return this.connections.snapshot();
  }

  /** Current snapshot first, then every published change. */
  async *watch(): AsyncGenerator<SystemHealthUpdatedPayload> {
    // Subscribe before reading the snapshot so a change published in between is not lost.
    const changes = pubSub.asyncIterableIterator<SystemHealthUpdatedPayload>(
      SYSTEM_HEALTH_UPDATED_TOPIC,
    );
    try {
      yield { adminSystemHealthUpdated: await this.getSystemHealth() };
      // Manual loop: PubSubAsyncIterableIterator's throw() signature is incompatible with for-await/yield*.
      while (true) {
        const next = await changes.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      await changes.return?.();
    }
  }

  async poll(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      this.logger.error({ err }, 'System health poll failed');
    }
  }

  private refresh(): Promise<SystemHealth> {
    this.inflight ??= this.collect().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async collect(): Promise<SystemHealth> {
    const checkedAt = new Date();
    const probes = await this.probeAll();
    await this.recordUptime(probes, checkedAt);
    const uptimes = await this.readUptime(checkedAt);

    const services = MONITORED_SERVICE_VALUES.map((name): ServiceHealth => {
      const probe = probes[name];
      return {
        name,
        status: classifyProbe(name, probe),
        responseMs: probe.up ? probe.responseMs : null,
        uptimePercent: uptimes[name],
        checkedAt,
      };
    });

    const [natsStreams, alerts, dlqPendingCount] = await Promise.all([
      this.streamLag(probes.NATS.up),
      this.firingAlerts(),
      this.dlqPending(probes.POSTGRES.up),
    ]);

    const snapshot: SystemHealth = {
      services,
      natsStreams,
      connections: this.connections.snapshot(),
      alerts: alerts ?? [],
      alertsAvailable: alerts !== null,
      dlqPendingCount,
      checkedAt,
    };
    this.latest = snapshot;
    this.publishIfChanged(snapshot);
    return snapshot;
  }

  private publishIfChanged(snapshot: SystemHealth): void {
    const fingerprint = healthFingerprint(snapshot);
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    const payload: SystemHealthUpdatedPayload = { adminSystemHealthUpdated: snapshot };
    void pubSub.publish(SYSTEM_HEALTH_UPDATED_TOPIC, payload);
  }

  private async probeAll(): Promise<Record<MonitoredService, ProbeResult>> {
    const [POSTGRES, REDIS, NATS, TEMPORAL, OBJECT_STORAGE] = await Promise.all([
      this.postgres.probe(),
      this.redisIndicator.probe(),
      this.nats.probe(),
      this.temporal.probe(),
      this.storage.probe(),
    ]);
    return { API_GATEWAY: this.probeEventLoop(), POSTGRES, REDIS, NATS, TEMPORAL, OBJECT_STORAGE };
  }

  /** The gateway is up by definition if it is answering; its latency is event-loop delay p99 since the last poll. */
  private probeEventLoop(): ProbeResult {
    const p99 = this.loopDelay.percentile(99);
    this.loopDelay.reset();
    return { up: true, responseMs: Number.isFinite(p99) ? p99 / NANOS_PER_MS : 0 };
  }

  private async recordUptime(
    probes: Record<MonitoredService, ProbeResult>,
    at: Date,
  ): Promise<void> {
    const bucket = uptimeBucket(at);
    const pipeline = this.redis.pipeline();
    for (const service of MONITORED_SERVICE_VALUES) {
      const key = uptimeKey(service, bucket);
      pipeline.hincrby(key, 'total', 1);
      if (probes[service].up) pipeline.hincrby(key, 'up', 1);
      pipeline.expire(key, UPTIME_BUCKET_TTL_SECONDS);
    }
    try {
      await pipeline.exec();
    } catch (err) {
      this.logger.warn({ err }, 'Could not record uptime samples');
    }
  }

  private async readUptime(at: Date): Promise<Record<MonitoredService, number | null>> {
    const current = uptimeBucket(at);
    const buckets = Array.from(
      { length: UPTIME_WINDOW_BUCKETS },
      (_, i) => current - i * UPTIME_BUCKET_SECONDS,
    );
    const pipeline = this.redis.pipeline();
    for (const service of MONITORED_SERVICE_VALUES) {
      for (const bucket of buckets) pipeline.hmget(uptimeKey(service, bucket), 'up', 'total');
    }

    const result: Record<MonitoredService, number | null> = {
      API_GATEWAY: null,
      POSTGRES: null,
      REDIS: null,
      NATS: null,
      TEMPORAL: null,
      OBJECT_STORAGE: null,
    };
    let replies: Array<[Error | null, unknown]> | null = null;
    try {
      replies = await pipeline.exec();
    } catch (err) {
      this.logger.warn({ err }, 'Could not read uptime samples');
    }
    MONITORED_SERVICE_VALUES.forEach((service, s) => {
      const counts = buckets.map((_, b) => {
        const reply = replies?.[s * buckets.length + b];
        const values = reply && !reply[0] && Array.isArray(reply[1]) ? reply[1] : [];
        return { up: Number(values[0] ?? 0), total: Number(values[1] ?? 0) };
      });
      result[service] = computeUptimePercent(counts);
    });
    return result;
  }

  private async streamLag(natsUp: boolean): Promise<NatsStreamLag[]> {
    if (!natsUp) return [];
    try {
      this.jsm ??= jetstreamManager(this.nc);
      const jsm = await this.jsm;
      const streams: NatsStreamLag[] = [];
      for await (const stream of jsm.streams.list()) {
        let consumerLag = 0;
        for await (const consumer of jsm.consumers.list(stream.config.name)) {
          consumerLag += consumer.num_pending;
        }
        streams.push({ name: stream.config.name, consumerLag });
      }
      return streams.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this.jsm = null;
      this.logger.warn({ err }, 'Could not read JetStream stream lag');
      return [];
    }
  }

  /** null = OpenObserve unavailable (distinct from "no alerts firing"). */
  private async firingAlerts(): Promise<ActiveAlert[] | null> {
    try {
      const alerts = await this.openObserve.alerts();
      return alerts
        .filter((a) => a.state === 'firing')
        .map(toActiveAlert)
        .sort((a, b) => a.since.getTime() - b.since.getTime());
    } catch (err) {
      this.logger.debug({ err }, 'OpenObserve alerts unavailable');
      return null;
    }
  }

  private async dlqPending(postgresUp: boolean): Promise<number> {
    if (!postgresUp) return 0;
    try {
      return await this.dlq.countPending();
    } catch (err) {
      this.logger.warn({ err }, 'Could not count pending DLQ messages');
      return 0;
    }
  }
}
