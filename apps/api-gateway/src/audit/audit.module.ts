import { Module } from '@nestjs/common';
import { AuditModule as AuditLibModule } from '@roviq/audit';
import { AuditConsumer } from './audit.consumer';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { auditDbProvider } from './audit-db.provider';
import { AuditPartitionMaintainer } from './audit-partition-maintainer';
import { natsProvider } from './nats.provider';
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
export class AuditModule {}
