import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { MinioHealthIndicator } from './indicators/minio.health';
import { NatsHealthIndicator } from './indicators/nats.health';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { TemporalHealthIndicator } from './indicators/temporal.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly nats: NatsHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
    private readonly minio: MinioHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.nats.isHealthy(),
      () => this.temporal.isHealthy(),
      () => this.minio.isHealthy(),
    ]);
  }

  // Temporal and MinIO back only some features; their outage must not take the gateway out of rotation.
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.nats.isHealthy(),
    ]);
  }
}
