import { Module } from '@nestjs/common';
import { AuditModule as AuditLibModule } from '@roviq/audit';
import { AuditConsumer } from './audit.consumer';
import { AuditInterceptor } from './audit.interceptor';
import { AuditResolver } from './audit.resolver';
import { AuditService } from './audit.service';
import { natsProvider } from './nats.provider';
import { AuditRepositoryModule } from './repositories/audit-repository.module';

@Module({
  imports: [AuditRepositoryModule, AuditLibModule],
  providers: [natsProvider, AuditConsumer, AuditResolver, AuditService, AuditInterceptor],
  exports: [AuditInterceptor],
})
export class AuditModule {}
