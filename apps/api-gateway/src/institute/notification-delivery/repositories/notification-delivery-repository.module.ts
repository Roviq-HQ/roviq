import { Module } from '@nestjs/common';
import { NotificationDeliveryDrizzleRepository } from './notification-delivery.drizzle-repository';
import { NotificationDeliveryRepository } from './notification-delivery.repository';

@Module({
  providers: [
    { provide: NotificationDeliveryRepository, useClass: NotificationDeliveryDrizzleRepository },
  ],
  exports: [NotificationDeliveryRepository],
})
export class NotificationDeliveryRepositoryModule {}
