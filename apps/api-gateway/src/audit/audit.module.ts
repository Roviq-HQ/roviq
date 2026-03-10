import { Module } from '@nestjs/common';
import { AuditConsumer } from './audit.consumer';
import { AuditResolver } from './audit.resolver';
import { AuditService } from './audit.service';
import { auditDbProvider } from './audit-db.provider';
import { natsProvider } from './nats.provider';

@Module({
  providers: [natsProvider, auditDbProvider, AuditConsumer, AuditResolver, AuditService],
  exports: [natsProvider],
})
export class AuditModule {}
