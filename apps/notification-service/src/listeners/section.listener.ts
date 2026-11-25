import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { NOTIFICATION_SUBJECTS, type SectionCapacityWarningEvent } from '@roviq/notifications';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  RecipientResolver,
  sourceOf,
} from '../services/recipient-resolver.service';

/**
 * `NOTIFICATION.section.capacity_warning`: tells the section's class teacher, else the
 * institute's academic coordinators, that the section reached its optimal strength (ROV-351).
 * The gateway emits it once per crossing; the dispatcher's dedupe key makes a redelivery a no-op.
 */
@Controller()
export class SectionListener {
  private readonly logger = new Logger(SectionListener.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @EventPattern(NOTIFICATION_SUBJECTS.SECTION_CAPACITY_WARNING, {
    stream: 'NOTIFICATION',
    durable: 'notification-section',
  })
  async handleCapacityWarning(
    @Payload() event: SectionCapacityWarningEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const found = await this.recipients.sectionCapacityAudience(event.tenantId, event.sectionId);
    if (!found) {
      this.logger.warn(
        `Section "${event.sectionId}" not found in institute "${event.tenantId}"; capacity warning not sent`,
      );
      return;
    }
    if (found.recipients.length === 0) {
      this.logger.warn(
        `Section "${event.sectionId}" in institute "${event.tenantId}" has no class teacher and the institute no academic coordinator; capacity warning not sent`,
      );
      return;
    }
    await this.dispatcher.dispatch({
      message: {
        type: 'SECTION_CAPACITY_WARNING',
        params: {
          sectionId: event.sectionId,
          standardId: found.standardId,
          sectionName: found.sectionName,
          standardName: found.standardName,
          currentStrength: event.currentStrength,
          optimal: event.optimal,
        },
      },
      audience: instituteAudience(event.tenantId),
      recipients: found.recipients,
      recipientsRef: null,
      source: sourceOf(ctx),
      inApp: true,
    });
  }
}
