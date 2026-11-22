import type { NatsConnection } from '@nats-io/nats-core';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { NotificationInboxConsumer } from './notification-inbox.consumer';
import { NotificationInboxResolver } from './notification-inbox.resolver';
import { NotificationInboxService } from './notification-inbox.service';
import {
  NOTIFICATION_INBOX_NATS,
  notificationInboxNatsProvider,
} from './notification-inbox-nats.provider';
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
export class NotificationInboxModule implements OnApplicationShutdown {
  constructor(@Inject(NOTIFICATION_INBOX_NATS) private readonly nc: NatsConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.nc.close();
  }
}
