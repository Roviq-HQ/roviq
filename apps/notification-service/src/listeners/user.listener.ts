import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { NOTIFICATION_SUBJECTS, type UserCreatedEvent } from '@roviq/notifications';
import type { Audience } from '../repositories/types';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import { PLATFORM_AUDIENCE } from '../services/recipient-resolver.service';

function welcomeAudience(event: UserCreatedEvent): Audience {
  if (event.scope === 'institute' && event.tenantId) {
    return { scope: 'institute', tenantId: event.tenantId, resellerId: null };
  }
  if (event.scope === 'reseller' && event.resellerId) {
    return { scope: 'reseller', tenantId: null, resellerId: event.resellerId };
  }
  return PLATFORM_AUDIENCE;
}

@Controller()
export class UserListener {
  private readonly logger = new Logger(UserListener.name);

  constructor(private readonly dispatcher: NotificationDispatcher) {}

  @EventPattern(NOTIFICATION_SUBJECTS.USER_CREATED, {
    stream: 'NOTIFICATION',
    durable: 'notification-user-created',
  })
  async handleUserCreated(
    @Payload() event: UserCreatedEvent,
    @Ctx() _ctx: JetStreamContext,
  ): Promise<void> {
    this.logger.log(`Sending welcome for user "${event.userId}" (scope: ${event.scope})`);
    // Email and SMS to the addresses captured at creation; the SMS is skipped without a phone.
    await this.dispatcher.dispatchSecret({
      message: {
        type: 'USER_WELCOME',
        params: {
          username: event.username,
          firstName: event.firstName,
          tempPassword: event.tempPassword,
        },
      },
      audience: welcomeAudience(event),
      recipientUserId: event.userId,
      addresses: { EMAIL: event.email, SMS: event.phone },
    });
  }
}
