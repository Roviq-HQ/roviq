import { Controller, Inject, Logger } from '@nestjs/common';
import { Ctx, EventPattern, NatsContext, Payload } from '@nestjs/microservices';
import { PRISMA_CLIENT } from '@roviq/nestjs-prisma';
import type { PrismaClient } from '@roviq/prisma-client';
import { NotificationTriggerService } from '../services/notification-trigger.service';

interface SubscriptionEventPayload {
  subscriptionId: string;
  organizationId: string;
}

interface WebhookEventPayload {
  eventType: string;
  providerEventId: string;
  subscriptionId?: string;
  organizationId?: string;
  provider: string;
}

@Controller()
export class BillingNotificationController {
  private readonly logger = new Logger(BillingNotificationController.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly triggerService: NotificationTriggerService,
  ) {}

  @EventPattern('billing.subscription.*')
  @EventPattern('billing.webhook.*')
  async handleBillingEvent(
    @Payload() data: SubscriptionEventPayload & WebhookEventPayload,
    @Ctx() ctx: NatsContext,
  ): Promise<void> {
    const subject = ctx.getSubject();
    this.logger.log(`Received billing event on subject "${subject}"`);

    if (subject.startsWith('billing.subscription.')) {
      await this.handleSubscriptionEvent(subject, data);
    } else if (subject.startsWith('billing.webhook.')) {
      await this.handleWebhookEvent(data);
    }
  }

  private async handleSubscriptionEvent(
    subject: string,
    data: SubscriptionEventPayload,
  ): Promise<void> {
    if (!data.subscriptionId) return;

    const details = await this.findSubscriptionDetails(data.subscriptionId);
    if (!details) return;

    const suffix = subject.split('.').pop() ?? '';
    const { notificationSubject, body } = this.composeSubscriptionMessage(suffix, details);
    if (!notificationSubject) return;

    const ownerUserId = await this.findOrganizationOwnerUserId(details.organizationId);
    await this.triggerForRecipients({ notificationSubject, body, suffix }, ownerUserId, null);
  }

  private async handleWebhookEvent(data: WebhookEventPayload): Promise<void> {
    if (!data.subscriptionId || !data.eventType) return;

    const details = await this.findSubscriptionDetails(data.subscriptionId);
    if (!details) return;

    const eventType = data.eventType.toLowerCase();
    const { notificationSubject, body } = this.composeWebhookMessage(eventType, details);
    if (!notificationSubject) return;

    const [ownerUserId, platformAdminUserId] = await Promise.all([
      this.findOrganizationOwnerUserId(details.organizationId),
      this.findPlatformAdminUserId(),
    ]);

    await this.triggerForRecipients(
      { notificationSubject, body, suffix: eventType },
      ownerUserId,
      platformAdminUserId,
    );
  }

  private composeSubscriptionMessage(
    suffix: string,
    details: SubscriptionDetails,
  ): { notificationSubject: string; body: string } {
    const { planName, planAmount } = details;

    switch (suffix) {
      case 'created':
        return planAmount === 0
          ? {
              notificationSubject: 'Subscription activated',
              body: `Your subscription to ${planName} is now active.`,
            }
          : {
              notificationSubject: 'Subscription pending payment',
              body: `A subscription to ${planName} has been created — complete payment to activate.`,
            };
      case 'canceled':
        return {
          notificationSubject: 'Subscription canceled',
          body: `Your ${planName} subscription has been canceled.`,
        };
      case 'paused':
        return {
          notificationSubject: 'Subscription paused',
          body: `Your ${planName} subscription has been paused.`,
        };
      case 'resumed':
        return {
          notificationSubject: 'Subscription resumed',
          body: `Your ${planName} subscription has been resumed.`,
        };
      default:
        return { notificationSubject: '', body: '' };
    }
  }

  private composeWebhookMessage(
    eventType: string,
    details: SubscriptionDetails,
  ): { notificationSubject: string; body: string } {
    const { planName, planAmount, planCurrency } = details;

    switch (eventType) {
      case 'subscription.activated':
        return {
          notificationSubject: 'Subscription activated',
          body: `Your subscription to ${planName} is now active.`,
        };
      case 'subscription.charged':
      case 'payment.captured':
        return {
          notificationSubject: 'Payment received',
          body: `Payment of ${planAmount} ${planCurrency} received for ${planName}.`,
        };
      case 'subscription.halted':
        return {
          notificationSubject: 'Payment failed',
          body: `Payment failed for ${planName} — please update your payment method.`,
        };
      case 'subscription.cancelled':
        return {
          notificationSubject: 'Subscription canceled',
          body: `Your ${planName} subscription has been canceled.`,
        };
      case 'subscription.completed':
        return {
          notificationSubject: 'Subscription ended',
          body: `Your ${planName} subscription period has ended.`,
        };
      default:
        return { notificationSubject: '', body: '' };
    }
  }

  private async triggerForRecipients(
    message: { notificationSubject: string; body: string; suffix: string },
    ownerUserId: string | null,
    platformAdminUserId: string | null,
  ): Promise<void> {
    const eventType = message.suffix.replace(/\./g, '-');

    if (ownerUserId) {
      await this.triggerService.trigger({
        workflowId: 'billing-event',
        to: { subscriberId: ownerUserId },
        payload: {
          subject: message.notificationSubject,
          body: message.body,
          eventType,
        },
      });
    }

    if (platformAdminUserId) {
      await this.triggerService.trigger({
        workflowId: 'billing-event',
        to: { subscriberId: platformAdminUserId },
        payload: {
          subject: message.notificationSubject,
          body: message.body,
          eventType,
        },
      });
    }
  }

  private async findSubscriptionDetails(
    subscriptionId: string,
  ): Promise<SubscriptionDetails | null> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        organization: { select: { id: true, name: true } },
      },
    });

    if (!sub) {
      this.logger.warn(`Subscription ${subscriptionId} not found for notification`);
      return null;
    }

    return {
      subscriptionId: sub.id,
      organizationId: sub.organizationId,
      organizationName: sub.organization.name,
      planName: sub.plan.name,
      planAmount: sub.plan.amount,
      planCurrency: sub.plan.currency,
    };
  }

  /**
   * Placeholder — will be implemented after the institute module.
   * Will send notifications to billing contacts in the future.
   */
  private async findOrganizationOwnerUserId(_orgId: string): Promise<string | null> {
    // TODO: Query membership with institute_admin role for this org
    return null;
  }

  private async findPlatformAdminUserId(): Promise<string | null> {
    const admin = await this.prisma.user.findUnique({
      where: { username: 'admin' },
      select: { id: true },
    });
    return admin?.id ?? null;
  }
}

interface SubscriptionDetails {
  subscriptionId: string;
  organizationId: string;
  organizationName: string;
  planName: string;
  planAmount: number;
  planCurrency: string;
}
