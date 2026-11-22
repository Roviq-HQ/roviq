import type { NatsConnection } from '@nats-io/nats-core';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuditModule as AuditLibModule } from '@roviq/audit';
import type pg from 'pg';
import { AuditConsumer } from './audit.consumer';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AUDIT_DB_POOL, auditDbProvider } from './audit-db.provider';
import { AuditPartitionMaintainer } from './audit-partition-maintainer';
import { NATS_CONNECTION, natsProvider } from './nats.provider';
import { AuditRepositoryModule } from './repositories/audit-repository.module';
import { AuditPartitionWorkerService } from './workflows/partition.worker';

@Module({
  imports: [AuditRepositoryModule, AuditLibModule],
  providers: [
    natsProvider,
    auditDbProvider,
    AuditPartitionMaintainer,
    AuditPartitionWorkerService,
    AuditConsumer,
    AuditService,
    AuditInterceptor,
  ],
  exports: [AuditInterceptor, AuditLibModule, AuditService],
})
export class AuditModule implements OnApplicationShutdown {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(AUDIT_DB_POOL) private readonly pool: pg.Pool,
  ) {}

  // After AuditConsumer flushed and acked in onModuleDestroy.
  async onApplicationShutdown(): Promise<void> {
    await this.nc.close();
    await this.pool.end();
  }
}
