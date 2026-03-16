import { jetstream } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { type RequestContext, requestContext } from '@roviq/common-types';
import { publishToDlq } from './dlq.js';

export interface SubscribeOptions {
  stream: string;
  subject: string;
  durableName: string;
  maxRetries?: number;
}

export interface MessageMeta {
  correlationId: string;
  tenantId?: string;
}

export async function subscribe<T>(
  nc: NatsConnection,
  options: SubscribeOptions,
  handler: (payload: T, meta: MessageMeta) => Promise<void>,
): Promise<void> {
  const js = jetstream(nc);
  const maxRetries = options.maxRetries ?? 3;
  const consumer = await js.consumers.get(options.stream, options.durableName);
  const messages = await consumer.consume();

  for await (const msg of messages) {
    const correlationId = msg.headers?.get('correlation-id') || crypto.randomUUID();
    const tenantId = msg.headers?.get('tenant-id') || undefined;
    const actorId = msg.headers?.get('actor-id') || '';
    const impersonatorId = msg.headers?.get('impersonator-id') || null;
    const payload = msg.json<T>();
    const redeliveryCount = msg.info.deliveryCount ?? 1;

    // Auto-restore request context from NATS headers
    const ctx: RequestContext = {
      tenantId: tenantId || null,
      userId: actorId,
      impersonatorId,
      correlationId,
    };

    try {
      await requestContext.run(ctx, () => handler(payload, { correlationId, tenantId }));
      msg.ack();
    } catch (err) {
      if (redeliveryCount >= maxRetries) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await publishToDlq(
          nc,
          msg.subject,
          payload,
          errorMessage,
          redeliveryCount,
          correlationId,
          tenantId,
        );
        msg.term();
      } else {
        msg.nak();
      }
    }
  }
}
