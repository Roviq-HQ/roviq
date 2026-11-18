import { Module } from '@nestjs/common';
import { DlqModule } from '../../dlq/dlq.module';
import { HealthModule } from '../../health/health.module';
import { PrometheusClient } from './prometheus.client';
import { AdminSystemHealthResolver } from './system-health/admin-system-health.resolver';
import { SystemHealthService } from './system-health/system-health.service';

@Module({
  imports: [
    HealthModule, // dependency probes
    DlqModule, // DlqService + the shared NATS connection
  ],
  providers: [PrometheusClient, SystemHealthService, AdminSystemHealthResolver],
  exports: [PrometheusClient],
})
export class AdminMonitoringModule {}
