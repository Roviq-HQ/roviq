import { randomUUID } from 'node:crypto';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { requestContext } from '@roviq/request-context';
import type { CanaryRequest } from './notification-workflow.types';

/**
 * `requestCanary` publishes on the NOTIFICATION stream from inside the worker. A Temporal
 * activity has no request, so it runs in a platform context of the canary's user, which also
 * gives the message its correlation id.
 */
export function createCanaryActivities(eventBus: EventBusService, canaryUserId: string | null) {
  return {
    async requestCanary(input: CanaryRequest): Promise<void> {
      if (canaryUserId === null) throw new Error('The delivery canary is not configured here');
      requestContext.run(
        {
          tenantId: null,
          resellerId: null,
          userId: canaryUserId,
          scope: 'platform',
          impersonatorId: null,
          correlationId: randomUUID(),
        },
        () =>
          eventBus.emit(EVENT_PATTERNS.NOTIFICATION.CANARY_REQUESTED, {
            channel: input.channel,
            requestedAt: input.requestedAt,
            tenantId: null,
          }),
      );
    },
  };
}
