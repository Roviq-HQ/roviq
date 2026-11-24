import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EVENT_PATTERNS, eventPayloadSchemas } from '@roviq/nats-jetstream';
import { DeliveryCanary } from '../services/delivery-canary.service';

/**
 * The canary schedule's request to send one test message (ROV-329). It travels the same path
 * as an institute's event, so a stuck stream or a dead consumer also stops the canary.
 */
@Controller()
export class CanaryListener {
  constructor(private readonly canary: DeliveryCanary) {}

  @EventPattern(EVENT_PATTERNS.NOTIFICATION.CANARY_REQUESTED, {
    stream: 'NOTIFICATION',
    durable: 'notification-canary',
  })
  async handle(@Payload() data: unknown): Promise<void> {
    const { channel, requestedAt } =
      eventPayloadSchemas[EVENT_PATTERNS.NOTIFICATION.CANARY_REQUESTED].parse(data);
    // A failed send is the canary's answer, not an error: a retry would send it again.
    await this.canary.send(channel, requestedAt);
  }
}
