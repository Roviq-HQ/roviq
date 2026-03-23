import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { REDIS_CLIENT } from '@roviq/redis';
import type { Redis } from 'ioredis';

const CACHE_PREFIX = 'entitlements:';

/**
 * NATS consumer that invalidates entitlement cache on subscription changes.
 * Listens to: subscription.plan_changed, subscription.cancelled, subscription.expired
 * Uses Redis directly (no dependency on EntitlementService to avoid rootDir issues).
 */
@Injectable()
export class EntitlementCacheConsumer implements OnModuleInit {
  private readonly logger = new Logger(EntitlementCacheConsumer.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject('BILLING_NATS_CLIENT') private readonly natsClient: ClientProxy,
  ) {}

  onModuleInit() {
    const events = [
      'BILLING.subscription.plan_changed',
      'BILLING.subscription.cancelled',
      'BILLING.subscription.expired',
    ];

    for (const pattern of events) {
      this.natsClient.send(pattern, {}).subscribe({
        next: async (data: { tenantId?: string }) => {
          if (data.tenantId) {
            await this.redis.del(`${CACHE_PREFIX}${data.tenantId}`);
            this.logger.debug(`Cache invalidated for tenant ${data.tenantId} on ${pattern}`);
          }
        },
        error: (err) => this.logger.warn(`Failed to subscribe to ${pattern}`, err),
      });
    }
  }
}
