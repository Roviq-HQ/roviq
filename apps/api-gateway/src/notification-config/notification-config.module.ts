import { Module } from '@nestjs/common';
import { NotificationConfigResolver } from './notification-config.resolver';
import { NotificationConfigService } from './notification-config.service';
import { NotificationConfigRepositoryModule } from './repositories/notification-config-repository.module';

@Module({
  imports: [NotificationConfigRepositoryModule],
  providers: [NotificationConfigService, NotificationConfigResolver],
})
export class NotificationConfigModule {}
