import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { DeviceTokenDrizzleRepository } from './device-token.drizzle-repository';
import { DeviceTokenRepository } from './device-token.repository';
import { NotificationInboxDrizzleRepository } from './notification-inbox.drizzle-repository';
import { NotificationInboxRepository } from './notification-inbox.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: NotificationInboxRepository, useClass: NotificationInboxDrizzleRepository },
    { provide: DeviceTokenRepository, useClass: DeviceTokenDrizzleRepository },
  ],
  exports: [NotificationInboxRepository, DeviceTokenRepository],
})
export class NotificationInboxRepositoryModule {}
