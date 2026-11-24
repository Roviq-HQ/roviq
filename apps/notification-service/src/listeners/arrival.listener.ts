import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EVENT_PATTERNS, eventPayloadSchemas } from '@roviq/nats-jetstream';
import { FlowArrivalRepository } from '../repositories/flow-arrival.repository';
import { FlowArrivals } from '../services/flow-arrivals.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';

/**
 * Proof from the gateway that a notification reached its recipient (ROV-332): the in-app copy
 * was read or archived, or a device showed the push. Either ends the notification's flow. The
 * event carries ids only; the rows are read here, keyed by recipient, before anything is done.
 */
@Controller()
export class ArrivalListener {
  private readonly logger = new Logger(ArrivalListener.name);

  constructor(
    private readonly repo: FlowArrivalRepository,
    private readonly arrivals: FlowArrivals,
    private readonly metrics: NotificationMetrics,
  ) {}

  @EventPattern(EVENT_PATTERNS.NOTIFICATION.INAPP_SEEN, {
    stream: 'NOTIFICATION',
    durable: 'notification-inapp-seen',
  })
  async handleSeen(@Payload() data: unknown): Promise<void> {
    const { notificationId, recipientUserId } =
      eventPayloadSchemas[EVENT_PATTERNS.NOTIFICATION.INAPP_SEEN].parse(data);
    const found = await this.repo.findInAppFlow(notificationId, recipientUserId);
    if (found.kind === 'not_found') {
      this.logger.warn(
        `Seen event for notification ${notificationId} of another recipient or none`,
      );
      return;
    }
    await this.arrivals.arrived(found.flowId, recipientUserId, 'IN_APP');
  }

  @EventPattern(EVENT_PATTERNS.NOTIFICATION.PUSH_ACKNOWLEDGED, {
    stream: 'NOTIFICATION',
    durable: 'notification-push-acknowledged',
  })
  async handlePushAcknowledged(@Payload() data: unknown): Promise<void> {
    const { notificationId, recipientUserId } =
      eventPayloadSchemas[EVENT_PATTERNS.NOTIFICATION.PUSH_ACKNOWLEDGED].parse(data);
    const result = await this.repo.acknowledgePush(notificationId, recipientUserId);
    if (result.kind === 'no_push') {
      this.logger.warn(`Push acknowledged for notification ${notificationId} that sent no push`);
      return;
    }
    if (result.kind !== 'recorded') return;
    this.metrics.reported(result.written);
    if (result.arrival) {
      const { flowId, recipientUserId: userId, channel } = result.arrival;
      await this.arrivals.arrived(flowId, userId, channel);
    }
  }
}
