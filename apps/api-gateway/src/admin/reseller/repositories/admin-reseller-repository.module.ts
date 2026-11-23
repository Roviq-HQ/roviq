import { Module } from '@nestjs/common';
import { AdminResellerDrizzleRepository } from './admin-reseller.drizzle-repository';
import { AdminResellerRepository } from './admin-reseller.repository';

@Module({
  providers: [{ provide: AdminResellerRepository, useClass: AdminResellerDrizzleRepository }],
  exports: [AdminResellerRepository],
})
export class AdminResellerRepositoryModule {}
