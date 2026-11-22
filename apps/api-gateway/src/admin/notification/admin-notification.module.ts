import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { AdminNotificationDeliveryRepository } from './admin-notification-delivery.repository';
import { AdminNotificationDeliveryResolver } from './admin-notification-delivery.resolver';
import { AdminNotificationDeliveryService } from './admin-notification-delivery.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    AdminNotificationDeliveryRepository,
    AdminNotificationDeliveryService,
    AdminNotificationDeliveryResolver,
  ],
})
export class AdminNotificationModule {}
