import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { NotificationConfigDrizzleRepository } from './notification-config.drizzle-repository';
import { NotificationConfigRepository } from './notification-config.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: NotificationConfigRepository,
      useClass: NotificationConfigDrizzleRepository,
    },
  ],
  exports: [NotificationConfigRepository],
})
export class NotificationConfigRepositoryModule {}
