import { Module } from '@nestjs/common';
import { NotificationDeliveryResolver } from './notification-delivery.resolver';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDeliveryRepositoryModule } from './repositories/notification-delivery-repository.module';

@Module({
  imports: [NotificationDeliveryRepositoryModule],
  providers: [NotificationDeliveryService, NotificationDeliveryResolver],
})
export class NotificationDeliveryModule {}
