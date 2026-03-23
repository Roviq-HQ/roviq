import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type FeatureLimits,
  SUBSCRIPTION_READER,
  type SubscriptionReader,
  UNLIMITED_ENTITLEMENTS,
} from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import type { Redis } from 'ioredis';

const CACHE_PREFIX = 'entitlements:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly eeEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() @Inject(SUBSCRIPTION_READER) private readonly reader?: SubscriptionReader,
  ) {
    this.eeEnabled = this.config.get('ROVIQ_EE') === 'true';
  }

  /**
   * Get entitlements for a tenant.
   * - EE disabled → UNLIMITED_ENTITLEMENTS
   * - EE enabled → Redis cache (5min TTL) → SubscriptionReader fallback
   */
  async getEntitlements(tenantId: string): Promise<FeatureLimits> {
    if (!this.eeEnabled || !this.reader) {
      return UNLIMITED_ENTITLEMENTS;
    }

    // Check Redis cache
    const cacheKey = `${CACHE_PREFIX}${tenantId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as FeatureLimits;
    }

    // Fetch from subscription reader
    const sub = await this.reader.findActiveByTenant(tenantId);
    const entitlements = sub?.plan.entitlements ?? UNLIMITED_ENTITLEMENTS;

    // Cache for 5 minutes
    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(entitlements));

    return entitlements;
  }

  /**
   * Check if a resource limit is within entitlements.
   * Returns true if within limit (or unlimited).
   */
  async checkLimit(
    tenantId: string,
    resource: keyof Pick<FeatureLimits, 'maxStudents' | 'maxStaff' | 'maxStorageMb'>,
    currentCount: number,
  ): Promise<boolean> {
    const entitlements = await this.getEntitlements(tenantId);
    const limit = entitlements[resource];
    // null = unlimited
    if (limit === null) return true;
    return currentCount < limit;
  }

  /** Invalidate cached entitlements for a tenant (called on subscription changes) */
  async invalidateCache(tenantId: string): Promise<void> {
    const cacheKey = `${CACHE_PREFIX}${tenantId}`;
    await this.redis.del(cacheKey);
    this.logger.debug(`Invalidated entitlements cache for tenant ${tenantId}`);
  }
}
