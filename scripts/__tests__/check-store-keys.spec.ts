import { describe, expect, it } from 'vitest';
import {
  findStoreHits,
  findStoreRuleBreaks,
  STORE_KEY_ALLOWLIST,
  subscriptionDecorators,
} from '../check-store-keys';

const SERVICE = 'apps/api-gateway/src/institute/thing/thing.service.ts';

describe('check-store-keys', () => {
  it('should pass the repository as it is', () => {
    expect(findStoreHits()).toEqual([]);
  });

  it('should give every allowlisted file a reason', () => {
    for (const entry of Object.values(STORE_KEY_ALLOWLIST)) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  describe('Redis keys', () => {
    it('should flag a key typed inline', () => {
      const source = 'await this.redis.set(`thing:${id}`, value);';
      expect(findStoreRuleBreaks(SERVICE, source)).toEqual(['redis-inline-key']);
    });

    it('should accept a key built from a constant', () => {
      const source = 'await this.redis.get(`${REDIS_KEYS.THING}${id}`);\nawait redis.del(key);';
      expect(findStoreRuleBreaks(SERVICE, source)).toEqual([]);
    });

    it('should accept a command inside a Lua script', () => {
      const source = "const script = `return redis.call('GET', KEYS[1])`;";
      expect(findStoreRuleBreaks(SERVICE, source)).toEqual([]);
    });

    it('should ignore an example in a comment', () => {
      expect(findStoreRuleBreaks(SERVICE, "// redis.get('thing:1')")).toEqual([]);
    });
  });

  describe('loaders', () => {
    it('should flag a caching loader in a provider that lives across requests', () => {
      const source = '@Injectable()\nclass A { loader = new DataLoader(load); }';
      expect(findStoreRuleBreaks(SERVICE, source)).toEqual(['shared-loader']);
    });

    it('should accept a request-scoped provider or a loader that does not cache', () => {
      const scoped = '@Injectable({ scope: Scope.REQUEST })\nclass A { l = new DataLoader(load); }';
      const uncached = 'class A { l = new DataLoader(load, { cache: false }); }';
      expect(findStoreRuleBreaks(SERVICE, scoped)).toEqual([]);
      expect(findStoreRuleBreaks(SERVICE, uncached)).toEqual([]);
    });
  });

  describe('workflow handles', () => {
    it('should flag a handle or a signal taken without the institute check', () => {
      expect(findStoreRuleBreaks(SERVICE, 'client.workflow.getHandle(workflowId)')).toEqual([
        'workflow-handle',
      ]);
      expect(findStoreRuleBreaks(SERVICE, 'await this.temporal.signal(id, NAME, [])')).toEqual([
        'workflow-handle',
      ]);
    });

    it('should accept a handle taken after the institute check, and a schedule handle', () => {
      const checked =
        "if (!isTenantWorkflowId(id, 'kind', tenantId)) throw gone;\nclient.workflow.getHandle(id);";
      expect(findStoreRuleBreaks(SERVICE, checked)).toEqual([]);
      expect(findStoreRuleBreaks(SERVICE, 'client.schedule.getHandle(SCHEDULE_ID)')).toEqual([]);
    });
  });

  describe('subscriptions', () => {
    const unfiltered = '@Subscription(() => Model, { resolve: (p) => p.x })\nthing() {}';
    const filtered =
      '@Subscription(() => Model, {\n  filter: (payload, _a, ctx) => own(payload, ctx),\n})\nthing() {}';

    it('should flag an institute or reseller subscription without a filter', () => {
      expect(findStoreRuleBreaks(SERVICE, unfiltered)).toEqual(['subscription-filter']);
    });

    it('should flag the one without a filter among several', () => {
      expect(findStoreRuleBreaks(SERVICE, `${filtered}\n${unfiltered}`)).toEqual([
        'subscription-filter',
      ]);
    });

    it('should accept a filtered subscription, and a platform one without', () => {
      expect(findStoreRuleBreaks(SERVICE, filtered)).toEqual([]);
      expect(
        findStoreRuleBreaks('apps/api-gateway/src/admin/thing/thing.subscription.ts', unfiltered),
      ).toEqual([]);
    });

    it('should read a decorator to its closing parenthesis', () => {
      expect(subscriptionDecorators(`${filtered}\n${unfiltered}`)).toHaveLength(2);
    });
  });

  describe('object storage', () => {
    it('should flag a storage call outside the files module', () => {
      const source = "await this.storage.presignGet('private', key, options);";
      expect(findStoreRuleBreaks(SERVICE, source)).toEqual(['storage-outside-files']);
    });

    it('should accept the files module and a health probe', () => {
      const call = "await this.storage.get('private', key);";
      expect(findStoreRuleBreaks('apps/api-gateway/src/files/file.service.ts', call)).toEqual([]);
      expect(findStoreRuleBreaks(SERVICE, "this.storage.bucketExists('private')")).toEqual([]);
    });
  });
});
