import type { GraphQLRequestContextWillSendResponse } from '@apollo/server';
import type { AuthUser } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type GqlContext, TenantApiRequestsPlugin } from '../tenant-api-requests.plugin';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@opentelemetry/api', () => ({
  metrics: { getMeter: () => ({ createCounter: () => ({ add }) }) },
}));

const TENANT = '00000000-0000-4000-8000-00000000000a';
const base = {
  userId: '00000000-0000-4000-8000-0000000000a1',
  membershipId: '00000000-0000-4000-8000-0000000000a2',
  roleId: '00000000-0000-4000-8000-0000000000a3',
  type: 'access',
} as const;

async function finish(user: AuthUser | undefined): Promise<void> {
  const listener = await new TenantApiRequestsPlugin().requestDidStart();
  const ctx = createMock<GraphQLRequestContextWillSendResponse<GqlContext>>({
    contextValue: { req: { user } },
  });
  await listener.willSendResponse?.(ctx);
}

describe('TenantApiRequestsPlugin', () => {
  beforeEach(() => {
    add.mockReset();
  });

  it('should count one request tagged with the tenant for an institute-scope caller', async () => {
    await finish({ ...base, _scope: 'institute', scope: 'institute', tenantId: TENANT });

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, { tenant_id: TENANT });
  });

  it('should not count platform-scope callers', async () => {
    await finish({ ...base, _scope: 'platform', scope: 'platform' });

    expect(add).not.toHaveBeenCalled();
  });

  it('should not count reseller-scope callers', async () => {
    await finish({
      ...base,
      _scope: 'reseller',
      scope: 'reseller',
      resellerId: '00000000-0000-4000-8000-0000000000f1',
    });

    expect(add).not.toHaveBeenCalled();
  });

  it('should not count unauthenticated operations', async () => {
    await finish(undefined);

    expect(add).not.toHaveBeenCalled();
  });
});
