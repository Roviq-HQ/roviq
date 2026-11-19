import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DlqModule } from '../dlq/dlq.module';
import { HealthController } from './health.controller';
import { NatsHealthIndicator } from './indicators/nats.health';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { StorageHealthIndicator } from './indicators/storage.health';
import { TemporalHealthIndicator } from './indicators/temporal.health';

const INDICATORS = [
  PostgresHealthIndicator,
  RedisHealthIndicator,
  NatsHealthIndicator,
  TemporalHealthIndicator,
  StorageHealthIndicator,
];

@Module({
  imports: [TerminusModule, DlqModule], // DlqModule exports the shared NATS connection
  controllers: [HealthController],
  providers: INDICATORS,
  exports: INDICATORS,
})
export class HealthModule {}
