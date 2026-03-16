import { jetstream } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { headers as natsHeaders } from '@nats-io/nats-core';
import { requestContext } from '@roviq/common-types';

export interface PublishOptions {
  correlationId?: string;
  tenantId?: string;
}

export async function publish<T>(
  nc: NatsConnection,
  subject: string,
  payload: T,
  options?: PublishOptions,
): Promise<void> {
  const js = jetstream(nc);
  const hdrs = natsHeaders();

  // Auto-serialize request context to NATS headers
  const ctx = requestContext.getStore();
  hdrs.set('correlation-id', options?.correlationId || ctx?.correlationId || crypto.randomUUID());
  hdrs.set('tenant-id', options?.tenantId || ctx?.tenantId || '');
  hdrs.set('actor-id', ctx?.userId || '');
  hdrs.set('impersonator-id', ctx?.impersonatorId || '');

  await js.publish(subject, JSON.stringify(payload), { headers: hdrs });
}
