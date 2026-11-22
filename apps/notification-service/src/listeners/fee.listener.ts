import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import {
  type FeeOverdueEvent,
  type FeeReminderEvent,
  NOTIFICATION_SUBJECTS,
} from '@roviq/notifications';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  RecipientResolver,
  sourceOf,
} from '../services/recipient-resolver.service';
import type { RegularPayload } from '../types/registry';

@Controller()
export class FeeListener {
  private readonly logger = new Logger(FeeListener.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @EventPattern('NOTIFICATION.fee.*', {
    stream: 'NOTIFICATION',
    durable: 'notification-fee',
  })
  async handleFeeEvent(
    @Payload() event: FeeOverdueEvent & FeeReminderEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const subject = ctx.getSubject();
    if (subject === NOTIFICATION_SUBJECTS.FEE_OVERDUE) {
      await this.toGuardians(event, ctx, {
        type: 'FEE_OVERDUE',
        params: {
          studentId: event.studentId,
          studentName: event.studentName,
          feeId: event.feeId,
          amount: event.amount,
          currency: event.currency,
          dueDate: event.dueDate,
          daysOverdue: event.daysOverdue,
          feeType: event.feeType,
        },
      });
    } else if (subject === NOTIFICATION_SUBJECTS.FEE_REMINDER) {
      await this.toGuardians(event, ctx, {
        type: 'FEE_REMINDER',
        params: {
          studentId: event.studentId,
          studentName: event.studentName,
          feeId: event.feeId,
          amount: event.amount,
          currency: event.currency,
          dueDate: event.dueDate,
          feeType: event.feeType,
          feePeriod: event.feePeriod,
        },
      });
    }
  }

  private async toGuardians(
    event: { tenantId: string; studentId: string },
    ctx: JetStreamContext,
    message: RegularPayload,
  ): Promise<void> {
    const guardians = await this.recipients.guardiansOfStudent(event.tenantId, event.studentId);
    if (guardians.length === 0) {
      this.logger.warn(
        `No linked guardian for student membership "${event.studentId}" in institute "${event.tenantId}"; ${message.type} not sent`,
      );
      return;
    }
    for (const recipient of guardians) {
      await this.dispatcher.dispatch({
        message,
        audience: instituteAudience(event.tenantId),
        recipient,
        source: sourceOf(ctx),
        inApp: true,
      });
    }
  }
}
