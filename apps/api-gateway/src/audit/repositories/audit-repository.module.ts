import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { AuditQueryDrizzleRepository } from './audit-query.drizzle-repository';
import { AuditQueryRepository } from './audit-query.repository';
import { AuditWriteDrizzleRepository } from './audit-write.drizzle-repository';
import { AuditWriteRepository } from './audit-write.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: AuditQueryRepository, useClass: AuditQueryDrizzleRepository },
    { provide: AuditWriteRepository, useClass: AuditWriteDrizzleRepository },
  ],
  exports: [AuditQueryRepository, AuditWriteRepository],
})
export class AuditRepositoryModule {}
