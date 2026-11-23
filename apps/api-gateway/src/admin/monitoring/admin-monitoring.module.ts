import { Module } from '@nestjs/common';
import { DlqModule } from '../../dlq/dlq.module';
import { HealthModule } from '../../health/health.module';
import { JetStreamMetrics } from './jetstream-metrics';
import { OpenObserveClient } from './openobserve.client';
import { AdminSystemHealthResolver } from './system-health/admin-system-health.resolver';
import { SystemHealthService } from './system-health/system-health.service';

@Module({
  imports: [
    HealthModule, // dependency probes
    DlqModule, // DlqService + the shared NATS connection
  ],
  providers: [OpenObserveClient, SystemHealthService, AdminSystemHealthResolver, JetStreamMetrics],
  exports: [OpenObserveClient],
})
export class AdminMonitoringModule {}
