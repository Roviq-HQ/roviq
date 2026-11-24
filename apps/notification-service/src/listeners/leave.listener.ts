import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { type LeaveDecidedEvent, NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  RecipientResolver,
  sourceOf,
} from '../services/recipient-resolver.service';

/**
 * `NOTIFICATION.leave.decided`: tells the applicant (a membership id) and, when the applicant
 * is a student, the linked guardians.
 */
@Controller()
export class LeaveListener {
  private readonly logger = new Logger(LeaveListener.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @EventPattern(NOTIFICATION_SUBJECTS.LEAVE_DECIDED, {
    stream: 'NOTIFICATION',
    durable: 'notification-leave',
  })
  async handleDecided(
    @Payload() event: LeaveDecidedEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const applicant = await this.recipients.member(event.tenantId, event.userId);
    if (!applicant) {
      this.logger.warn(
        `Leave applicant membership "${event.userId}" not found in institute "${event.tenantId}"; not sent`,
      );
      return;
    }
    const audience = instituteAudience(event.tenantId);
    const source = sourceOf(ctx);
    const leave = {
      leaveId: event.leaveId,
      status: event.status,
      applicantName: event.applicantName ?? null,
      startDate: event.startDate ?? null,
      endDate: event.endDate ?? null,
    };
    await this.dispatcher.dispatch({
      message: {
        type: 'LEAVE_DECIDED',
        params: { ...leave, audience: 'applicant' },
      },
      audience,
      recipients: [applicant.recipient],
      recipientsRef: null,
      source,
      inApp: true,
    });
    if (!applicant.isStudent) return;

    const guardians = await this.recipients.guardiansOfStudent(event.tenantId, event.userId);
    await this.dispatcher.dispatch({
      message: {
        type: 'LEAVE_DECIDED',
        params: { ...leave, audience: 'guardian' },
      },
      audience,
      recipients: guardians,
      recipientsRef: { kind: 'guardians_of_student', studentMembershipId: event.userId },
      source,
      // The applicant's flow has the event's own key; the guardians' flow needs another.
      dedupeKey: `${source.stream}:${source.sequence}:LEAVE_DECIDED:guardians`,
      inApp: true,
    });
  }
}
