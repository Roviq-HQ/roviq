import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_ENTITLEMENTS,
  type FeatureLimits,
  type SubscriptionReader,
  UNLIMITED_ENTITLEMENTS,
} from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntitlementService } from '../entitlement.service';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';
const MB = 1024 * 1024;
const PLAN: FeatureLimits = {
  maxStudents: 100,
  maxStaff: 10,
  maxStorageMb: 512,
  auditLogRetentionDays: 90,
  features: [],
};

describe('EntitlementService', () => {
  let cache: Map<string, string>;
  let redis: Redis;
  let findActiveByTenant: ReturnType<typeof vi.fn<SubscriptionReader['findActiveByTenant']>>;

  const build = (ee: boolean, withReader = true) =>
    new EntitlementService(
      new ConfigService({ ROVIQ_EE: ee ? 'true' : 'false' }),
      redis,
      withReader ? { findActiveByTenant } : undefined,
    );

  beforeEach(() => {
    cache = new Map();
    redis = createMock<Redis>({
      get: vi.fn(async (key: string) => cache.get(key) ?? null),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => {
        cache.set(key, value);
        return 'OK' as const;
      }),
    });
    findActiveByTenant = vi
      .fn<SubscriptionReader['findActiveByTenant']>()
      .mockResolvedValue({ plan: { entitlements: PLAN } });
  });

  it('should set no limits when EE is off, without reading subscriptions', async () => {
    const service = build(false);

    await expect(service.getEntitlements(TENANT_ID)).resolves.toEqual(UNLIMITED_ENTITLEMENTS);
    await expect(service.storageLimitBytes(TENANT_ID)).resolves.toBeNull();
    expect(findActiveByTenant).not.toHaveBeenCalled();
  });

  it("should give the storage of the institute's plan in bytes", async () => {
    await expect(build(true).storageLimitBytes(TENANT_ID)).resolves.toBe(512 * MB);
  });

  it('should give an institute without a subscription the default allowance, not unlimited', async () => {
    findActiveByTenant.mockResolvedValue(null);

    await expect(build(true).storageLimitBytes(TENANT_ID)).resolves.toBe(
      (DEFAULT_ENTITLEMENTS.maxStorageMb ?? 0) * MB,
    );
  });

  it('should give no limit for a plan whose storage is unlimited', async () => {
    findActiveByTenant.mockResolvedValue({
      plan: { entitlements: { ...PLAN, maxStorageMb: null } },
    });

    await expect(build(true).storageLimitBytes(TENANT_ID)).resolves.toBeNull();
  });

  it('should read the subscription once and answer from the cache after that', async () => {
    const service = build(true);

    await service.getEntitlements(TENANT_ID);
    await service.getEntitlements(TENANT_ID);

    expect(findActiveByTenant).toHaveBeenCalledTimes(1);
  });
});
