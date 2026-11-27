import type { AuthUser } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it } from 'vitest';
import { isOwnGroupResolution } from '../group-subscription-filter';

const TENANT_A = '019a0000-0000-7000-8000-00000000000a';
const TENANT_B = '019a0000-0000-7000-8000-00000000000b';
const GROUP = '019a0000-0000-7000-8000-0000000000aa';

const as = (user: Partial<AuthUser>) => ({ req: { user: createMock<AuthUser>(user) } });
const event = (tenantId: string | undefined, groupId = GROUP) => ({
  groupMembershipResolved: { tenantId, groupId },
});

describe('isOwnGroupResolution', () => {
  const instituteA = as({ scope: 'institute', tenantId: TENANT_A });

  it('should deliver a resolution of the asked group to its own institute', () => {
    expect(isOwnGroupResolution(event(TENANT_A), { groupId: GROUP }, instituteA)).toBe(true);
  });

  it("should refuse another institute's resolution, even when the group id is asked for", () => {
    expect(isOwnGroupResolution(event(TENANT_B), { groupId: GROUP }, instituteA)).toBe(false);
  });

  it('should refuse an event that names no institute', () => {
    expect(isOwnGroupResolution(event(undefined), { groupId: GROUP }, instituteA)).toBe(false);
  });

  it('should refuse a resolution of a group that was not asked for', () => {
    expect(isOwnGroupResolution(event(TENANT_A), { groupId: TENANT_B }, instituteA)).toBe(false);
  });

  it('should refuse a caller who is not signed in to an institute', () => {
    const reseller = as({ scope: 'reseller' });
    expect(isOwnGroupResolution(event(TENANT_A), { groupId: GROUP }, reseller)).toBe(false);
  });
});
