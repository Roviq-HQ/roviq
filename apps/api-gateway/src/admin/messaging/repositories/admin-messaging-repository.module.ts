import { Module } from '@nestjs/common';
import { AdminMessagingDrizzleRepository } from './admin-messaging.drizzle-repository';
import { AdminMessagingRepository } from './admin-messaging.repository';

@Module({
  providers: [{ provide: AdminMessagingRepository, useClass: AdminMessagingDrizzleRepository }],
  exports: [AdminMessagingRepository],
})
export class AdminMessagingRepositoryModule {}
