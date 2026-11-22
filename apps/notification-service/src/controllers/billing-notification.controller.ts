import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { BillingReadRepository } from '../repositories/billing-read.repository';
import type { SubscriptionDetails } from '../repositories/types';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  PLATFORM_AUDIENCE,
  sourceOf,
} from '../services/recipient-resolver.service';
import type { BillingMessageKind } from '../types/billing-event.type';

interface SubscriptionEventPayload {
  subscriptionId: string;
  instituteId: string;
}

interface WebhookEventPayload {
  eventType: string;
  providerEventId: string;
  subscriptionId?: string;
  instituteId?: string;
  provider: string;
}

function subscriptionKind(suffix: string, details: SubscriptionDetails): BillingMessageKind | null {
  switch (suffix) {
    case 'created':
      return details.planAmount === 0 ? 'subscription-activated' : 'subscription-pending';
    case 'canceled':
      return 'subscription-canceled';
    case 'paused':
      return 'subscription-paused';
    case 'resumed':
      return 'subscription-resumed';
    default:
      return null;
  }
}

function webhookKind(eventType: string): BillingMessageKind | null {
  switch (eventType) {
    case 'subscription.activated':
      return 'subscription-activated';
    case 'subscription.charged':
    case 'payment.captured':
      return 'payment-received';
    case 'subscription.halted':
      return 'payment-failed';
    case 'subscription.cancelled':
      return 'subscription-canceled';
    case 'subscription.completed':
      return 'subscription-ended';
    default:
      return null;
  }
}

@Controller()
export class BillingNotificationController {
  private readonly logger = new Logger(BillingNotificationController.name);

  constructor(
    private readonly billingRepo: BillingReadRepository,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @EventPattern('BILLING.subscription.*', {
    stream: 'BILLING',
    durable: 'notification-billing-subscription',
  })
  async handleSubscriptionEvent(
    @Payload() data: SubscriptionEventPayload,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const subject = ctx.getSubject();
    this.logger.log(`Received billing subscription event on subject "${subject}"`);

    if (!data.subscriptionId) return;

    const details = await this.billingRepo.findSubscriptionDetails(data.subscriptionId);
    if (!details) return;

    const kind = subscriptionKind(subject.split('.').pop() ?? '', details);
    if (!kind) return;

    const ownerUserId = await this.findInstituteOwnerUserId(details.instituteId);
    await this.notify(kind, details, ownerUserId, null, ctx);
  }

  @EventPattern('BILLING.webhook.*', {
    stream: 'BILLING',
    durable: 'notification-billing-webhook',
  })
  async handleWebhookEvent(
    @Payload() data: WebhookEventPayload,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const subject = ctx.getSubject();
    this.logger.log(`Received billing webhook event on subject "${subject}"`);

    if (!data.subscriptionId || !data.eventType) return;

    const details = await this.billingRepo.findSubscriptionDetails(data.subscriptionId);
    if (!details) return;

    const kind = webhookKind(data.eventType.toLowerCase());
    if (!kind) return;

    const [ownerUserId, platformAdminUser] = await Promise.all([
      this.findInstituteOwnerUserId(details.instituteId),
      this.billingRepo.findPlatformAdminUser(),
    ]);
    await this.notify(kind, details, ownerUserId, platformAdminUser?.id ?? null, ctx);
  }

  private async notify(
    kind: BillingMessageKind,
    details: SubscriptionDetails,
    ownerUserId: string | null,
    platformAdminUserId: string | null,
    ctx: JetStreamContext,
  ): Promise<void> {
    const message = {
      type: 'BILLING_EVENT',
      params: {
        kind,
        subscriptionId: details.subscriptionId,
        instituteId: details.instituteId,
        planName: details.planName,
        planAmount: details.planAmount,
        planCurrency: details.planCurrency,
      },
    } as const;
    const source = sourceOf(ctx);

    if (ownerUserId) {
      await this.dispatcher.dispatch({
        message,
        audience: instituteAudience(details.instituteId),
        recipient: { userId: ownerUserId, membershipId: null },
        source,
        inApp: true,
      });
    }
    if (platformAdminUserId) {
      await this.dispatcher.dispatch({
        message,
        audience: PLATFORM_AUDIENCE,
        recipient: { userId: platformAdminUserId, membershipId: null },
        source,
        inApp: true,
      });
    }
  }

  /**
   * Placeholder — will be implemented after the institute-management module.
   * Will send notifications to billing contacts in the future.
   */
  private async findInstituteOwnerUserId(_instituteId: string): Promise<string | null> {
    // TODO: Query membership with institute_admin role for this institute
    return null;
  }
}
