import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EVENT_PATTERNS, eventPayloadSchemas } from '@roviq/nats-jetstream';
import { TemplateSyncStarter } from '../services/template-sync-starter.service';

/** The gateway's request to sync a provider account's WhatsApp templates (ROV-333). */
@Controller()
export class TemplateSyncListener {
  constructor(private readonly starter: TemplateSyncStarter) {}

  @EventPattern(EVENT_PATTERNS.NOTIFICATION.WHATSAPP_TEMPLATES_SYNC_REQUESTED, {
    stream: 'NOTIFICATION',
    durable: 'notification-template-sync',
  })
  async handle(@Payload() data: unknown): Promise<void> {
    const { providerAccountId } =
      eventPayloadSchemas[EVENT_PATTERNS.NOTIFICATION.WHATSAPP_TEMPLATES_SYNC_REQUESTED].parse(
        data,
      );
    // A run already in progress covers this request; a redelivery starts nothing twice.
    await this.starter.start(providerAccountId);
  }
}
