import { Module } from '@nestjs/common';
import { NotificationInboxConsumer } from './notification-inbox.consumer';
import { NotificationInboxResolver } from './notification-inbox.resolver';
import { NotificationInboxService } from './notification-inbox.service';
import { notificationInboxNatsProvider } from './notification-inbox-nats.provider';
import { NotificationInboxRepositoryModule } from './repositories/notification-inbox-repository.module';

@Module({
  imports: [NotificationInboxRepositoryModule],
  providers: [
    notificationInboxNatsProvider,
    NotificationInboxConsumer,
    NotificationInboxService,
    NotificationInboxResolver,
  ],
})
export class NotificationInboxModule {}
