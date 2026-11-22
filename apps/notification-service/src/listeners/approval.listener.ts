import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import {
  type ApprovalRequestedEvent,
  type ApprovalResolvedEvent,
  NOTIFICATION_SUBJECTS,
} from '@roviq/notifications';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  RecipientResolver,
  sourceOf,
} from '../services/recipient-resolver.service';
import type { RegularPayload } from '../types/registry';

/** No producer emits approval events yet; their ids are membership ids. */
@Controller()
export class ApprovalListener {
  private readonly logger = new Logger(ApprovalListener.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @EventPattern('NOTIFICATION.approval.*', {
    stream: 'NOTIFICATION',
    durable: 'notification-approval',
  })
  async handleApprovalEvent(
    @Payload() event: ApprovalRequestedEvent & ApprovalResolvedEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const subject = ctx.getSubject();
    if (subject === NOTIFICATION_SUBJECTS.APPROVAL_REQUESTED) {
      await this.toMember(event.tenantId, event.approverId, ctx, {
        type: 'APPROVAL_REQUESTED',
        params: {
          approvalType: event.approvalType,
          requesterName: event.requesterName,
          summary: event.summary,
          entityId: event.entityId,
        },
      });
    } else if (subject === NOTIFICATION_SUBJECTS.APPROVAL_RESOLVED) {
      await this.toMember(event.tenantId, event.requesterId, ctx, {
        type: 'APPROVAL_RESOLVED',
        params: {
          approvalType: event.approvalType,
          status: event.status,
          reviewerName: event.reviewerName,
          remarks: event.remarks ?? null,
        },
      });
    }
  }

  private async toMember(
    tenantId: string,
    membershipId: string,
    ctx: JetStreamContext,
    message: RegularPayload,
  ): Promise<void> {
    const member = await this.recipients.member(tenantId, membershipId);
    if (!member) {
      this.logger.warn(
        `Membership "${membershipId}" not found in institute "${tenantId}"; ${message.type} not sent`,
      );
      return;
    }
    await this.dispatcher.dispatch({
      message,
      audience: instituteAudience(tenantId),
      recipient: member.recipient,
      source: sourceOf(ctx),
      inApp: true,
    });
  }
}
