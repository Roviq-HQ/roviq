import {
  AckPolicy,
  type ConsumerMessages,
  DeliverPolicy,
  type JsMsg,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EVENT_PATTERNS, STREAMS } from '@roviq/nats-jetstream';
import { pubSub } from '@roviq/pubsub';
import { z } from 'zod';
import {
  inAppCreatedSchema,
  type NotificationFeedEvent,
  notificationFeedTopic,
} from './notification-feed';
import { NOTIFICATION_INBOX_NATS } from './notification-inbox-nats.provider';

export const NOTIFICATION_FEED_CONSUMER = 'api-gateway-notification-feed';

// JetStreamClient publishes the NestJS packet `{ pattern, data }`.
const envelopeSchema = z.object({ data: inAppCreatedSchema });

/** Parses one `NOTIFICATION.inapp.created` message; null when it is not one. */
export function feedEventOf(
  raw: string,
): { recipientUserId: string; event: NotificationFeedEvent } | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    recipientUserId: parsed.data.data.recipientUserId,
    event: { notificationId: parsed.data.data.notificationId },
  };
}

/**
 * Turns each new in-app notification into a wake-up on the recipient's own pubsub topic.
 * Carries only the id: the subscription reads the row as the subscriber, so an event
 * never shows anything the subscriber could not read anyway.
 */
@Injectable()
export class NotificationInboxConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationInboxConsumer.name);
  private messages: ConsumerMessages | null = null;

  constructor(@Inject(NOTIFICATION_INBOX_NATS) private readonly nc: NatsConnection) {}

  async onModuleInit(): Promise<void> {
    await this.ensureConsumer();
    void this.consume();
  }

  async onModuleDestroy(): Promise<void> {
    await this.messages?.close();
    await this.nc.close();
  }

  private async ensureConsumer(): Promise<void> {
    const jsm = await jetstreamManager(this.nc);
    const stream = STREAMS.NOTIFICATION.name;
    const existing = await jsm.consumers.info(stream, NOTIFICATION_FEED_CONSUMER).catch(() => null);
    if (existing) return;
    await jsm.consumers.add(stream, {
      durable_name: NOTIFICATION_FEED_CONSUMER,
      filter_subject: EVENT_PATTERNS.NOTIFICATION.INAPP_CREATED,
      ack_policy: AckPolicy.Explicit,
      // A wake-up for a feed nobody watched while the gateway was down is worthless.
      deliver_policy: DeliverPolicy.New,
      max_deliver: 1,
    });
  }

  private async consume(): Promise<void> {
    const consumer = await jetstream(this.nc).consumers.get(
      STREAMS.NOTIFICATION.name,
      NOTIFICATION_FEED_CONSUMER,
    );
    try {
      this.messages = await consumer.consume();
      for await (const msg of this.messages) this.handle(msg);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('closed'))) {
        this.logger.error('Notification feed consumer stopped', err);
      }
    }
  }

  private handle(msg: JsMsg): void {
    const parsed = feedEventOf(msg.string());
    if (parsed) {
      void pubSub.publish(notificationFeedTopic(parsed.recipientUserId), parsed.event);
    } else {
      this.logger.warn(`Dropped malformed ${msg.subject} message (seq ${msg.seq})`);
    }
    msg.ack();
  }
}
