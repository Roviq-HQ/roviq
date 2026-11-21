import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS, type JetStreamClient } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import type { Redis } from 'ioredis';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntitlementCacheConsumer } from '../entitlement-cache.consumer';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';

describe('EntitlementCacheConsumer', () => {
  let del: ReturnType<typeof vi.fn<(key: string) => Promise<number>>>;
  let eventBus: EventBusService;

  beforeEach(() => {
    del = vi.fn<(key: string) => Promise<number>>().mockResolvedValue(1);
    new EntitlementCacheConsumer(createMock<Redis>({ del })).onModuleInit();
    // The real bus, so the test breaks if the shape it publishes ever changes.
    eventBus = new EventBusService(createMock<JetStreamClient>({ emit: vi.fn(() => EMPTY) }));
  });

  it("should drop the institute's cached entitlements when its subscription changes", async () => {
    eventBus.emit(EVENT_PATTERNS.BILLING.subscription.status_changed, {
      subscriptionId: '00000000-0000-7000-a000-000000000002',
      tenantId: TENANT_ID,
      resellerId: '00000000-0000-7000-a000-000000000004',
      planId: '00000000-0000-7000-a000-000000000003',
      status: 'ACTIVE',
    });

    await vi.waitFor(() => expect(del).toHaveBeenCalledWith(`entitlements:${TENANT_ID}`));
  });
});
