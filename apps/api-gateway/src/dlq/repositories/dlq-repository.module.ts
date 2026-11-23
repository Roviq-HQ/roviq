import { Module } from '@nestjs/common';
import { DlqDrizzleRepository } from './dlq.drizzle-repository';
import { DlqRepository } from './dlq.repository';

@Module({
  providers: [{ provide: DlqRepository, useClass: DlqDrizzleRepository }],
  exports: [DlqRepository],
})
export class DlqRepositoryModule {}
