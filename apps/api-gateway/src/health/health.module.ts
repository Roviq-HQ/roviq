import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DlqModule } from '../dlq/dlq.module';
import { HealthController } from './health.controller';
import { MinioHealthIndicator } from './indicators/minio.health';
import { NatsHealthIndicator } from './indicators/nats.health';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { TemporalHealthIndicator } from './indicators/temporal.health';

const INDICATORS = [
  PostgresHealthIndicator,
  RedisHealthIndicator,
  NatsHealthIndicator,
  TemporalHealthIndicator,
  MinioHealthIndicator,
];

@Module({
  imports: [TerminusModule, DlqModule], // DlqModule exports the shared NATS connection
  controllers: [HealthController],
  providers: INDICATORS,
  exports: INDICATORS,
})
export class HealthModule {}
