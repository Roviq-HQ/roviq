import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService, type HealthIndicatorFunction } from '@nestjs/terminus';
import { NoRateLimit } from '../common/rate-limit/rate-limit.decorator';
import { NatsHealthIndicator } from './indicators/nats.health';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { StorageHealthIndicator } from './indicators/storage.health';
import { TemporalHealthIndicator } from './indicators/temporal.health';

/** How long one answer is reused: a probe every few seconds costs one round of checks. */
export const HEALTH_ANSWER_TTL_MS = 5000;

export interface HealthAnswer {
  status: 'ok';
}

interface Remembered {
  at: number;
  answer: Promise<HealthAnswer>;
}

/**
 * Liveness and readiness for probes. Anyone can call these routes, so they answer only
 * whether the gateway is healthy: which dependency is down is written to the log, and shown
 * to a platform admin on the monitoring page (`adminSystemHealth`).
 */
// A probe must keep answering whatever else its address sends; the remembered answer bounds its cost.
@NoRateLimit()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly remembered = new Map<string, Remembered>();

  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly nats: NatsHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
    private readonly storage: StorageHealthIndicator,
  ) {}

  @Get()
  check(): Promise<HealthAnswer> {
    return this.answer('all', [
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.nats.isHealthy(),
      () => this.temporal.isHealthy(),
      () => this.storage.isHealthy(),
    ]);
  }

  // Temporal and object storage back only some features; their outage must not take the gateway out of rotation.
  @Get('ready')
  ready(): Promise<HealthAnswer> {
    return this.answer('ready', [
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.nats.isHealthy(),
    ]);
  }

  private answer(name: string, indicators: HealthIndicatorFunction[]): Promise<HealthAnswer> {
    const last = this.remembered.get(name);
    if (last && Date.now() - last.at < HEALTH_ANSWER_TTL_MS) return last.answer;
    const answer = this.run(name, indicators);
    this.remembered.set(name, { at: Date.now(), answer });
    return answer;
  }

  private async run(name: string, indicators: HealthIndicatorFunction[]): Promise<HealthAnswer> {
    try {
      await this.health.check(indicators);
      return { status: 'ok' };
    } catch (err) {
      this.logger.warn({ err, reason: downOf(err) }, `Health check "${name}" failed`);
      throw new ServiceUnavailableException({ status: 'error' });
    }
  }
}

/** The names of the dependencies a failed terminus check reports as down. */
function downOf(err: unknown): string {
  if (!(err instanceof ServiceUnavailableException)) return 'unknown';
  const response = err.getResponse();
  if (typeof response !== 'object' || response === null || !('error' in response)) return 'unknown';
  const down = response.error;
  return typeof down === 'object' && down !== null ? Object.keys(down).join(', ') : 'unknown';
}
