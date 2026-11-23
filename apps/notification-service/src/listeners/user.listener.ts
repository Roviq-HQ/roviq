import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { NOTIFICATION_SUBJECTS, type UserCreatedEvent } from '@roviq/notifications';
import { InstitutePortal } from '../config/institute-portal';
import { RecipientReadRepository } from '../repositories/recipient-read.repository';
import type { Audience } from '../repositories/types';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import { PLATFORM_AUDIENCE } from '../services/recipient-resolver.service';
import type { UserWelcomeParams } from '../types/secret.types';

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

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientReadRepository,
    private readonly portal: InstitutePortal,
  ) {}

  @EventPattern(NOTIFICATION_SUBJECTS.USER_CREATED, {
    stream: 'NOTIFICATION',
    durable: 'notification-user-created',
  })
  async handleUserCreated(
    @Payload() event: UserCreatedEvent,
    @Ctx() _ctx: JetStreamContext,
  ): Promise<void> {
    this.logger.log(`Sending welcome for user "${event.userId}" (scope: ${event.scope})`);
    // Email and SMS to the addresses the event names; a channel with none is skipped.
    await this.dispatcher.dispatchSecret({
      message: {
        type: 'USER_WELCOME',
        params: {
          username: event.username,
          firstName: event.firstName,
          tempPassword: event.tempPassword,
          institute: await this.instituteOf(event),
        },
      },
      audience: welcomeAudience(event),
      recipientUserId: event.userId,
      addresses: { EMAIL: event.email, SMS: event.phone },
    });
  }

  private async instituteOf(event: UserCreatedEvent): Promise<UserWelcomeParams['institute']> {
    if (event.scope !== 'institute' || !event.tenantId) return null;
    const name = await this.recipients.findInstituteName(event.tenantId);
    return name ? { name, signInUrl: this.portal.signInUrl() } : null;
  }
}
