import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { toSubscriptionKey } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { pubSub } from '@roviq/pubsub';
import { REDIS_CLIENT } from '@roviq/redis';
import type { Redis } from 'ioredis';

const CACHE_PREFIX = 'entitlements:';

// Every subscription event (created, activated, plan changed, cancelled …) is also published
// under this one subject, so a new event type cannot be forgotten here.
const SUBJECT = EVENT_PATTERNS.BILLING.subscription.status_changed;
const PAYLOAD_KEY = toSubscriptionKey(SUBJECT);

/** Drops an institute's cached entitlements whenever its subscription changes. */
@Injectable()
export class EntitlementCacheConsumer implements OnModuleInit {
  private readonly logger = new Logger(EntitlementCacheConsumer.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit() {
    // The event bus publishes the payload under its GraphQL subscription field name.
    void pubSub.subscribe(SUBJECT, (message: Record<string, { tenantId?: unknown }>) => {
      const tenantId = message[PAYLOAD_KEY]?.tenantId;
      if (typeof tenantId !== 'string' || !tenantId) return;
      this.redis
        .del(`${CACHE_PREFIX}${tenantId}`)
        .then(() => this.logger.debug(`Entitlement cache dropped for ${tenantId}`))
        .catch((err) =>
          this.logger.warn({ err }, `Failed to drop entitlement cache for ${tenantId}`),
        );
    });
  }
}
