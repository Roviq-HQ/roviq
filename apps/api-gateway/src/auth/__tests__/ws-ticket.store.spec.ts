import type { InstituteContext, PlatformContext, ResellerContext } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeWsTicket, issueWsTicket, WS_TICKET_TTL_SECONDS } from '../ws-ticket.store';

const UNKNOWN_TICKET = '0b9d6a2e-5d0f-4c56-9d0a-0f3f6f3f8a11';

const instituteUser: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  userId: 'user-1',
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
  mustChangePassword: false,
  tenantId: 'tenant-1',
  resellerId: 'reseller-1',
};

const resellerUser: ResellerContext = {
  _scope: 'reseller',
  scope: 'reseller',
  userId: 'user-2',
  membershipId: 'membership-2',
  roleId: 'role-2',
  type: 'access',
  mustChangePassword: false,
  resellerId: 'reseller-1',
};

const platformUser: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  userId: 'user-3',
  membershipId: 'membership-3',
  roleId: 'role-3',
  type: 'access',
  mustChangePassword: false,
};

function createFakeRedis() {
  const store = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK' as const;
  });
  const getdel = vi.fn(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  });
  return { store, set, getdel, redis: createMock<Redis>({ set, getdel }) };
}

describe('ws-ticket store', () => {
  let fake: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    fake = createFakeRedis();
  });

  describe('issueWsTicket', () => {
    it('should store the user under a UUID ticket key with a 30 second TTL', async () => {
      const ticket = await issueWsTicket(fake.redis, instituteUser);

      expect(ticket).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(WS_TICKET_TTL_SECONDS).toBe(30);
      expect(fake.set).toHaveBeenCalledTimes(1);
      const [key, value, mode, ttl] = fake.set.mock.calls[0];
      expect(key).toBe(`ws-ticket:${ticket}`);
      expect(JSON.parse(value)).toEqual(instituteUser);
      expect(mode).toBe('EX');
      expect(ttl).toBe(30);
    });

    it('should mint a different ticket on every call', async () => {
      const first = await issueWsTicket(fake.redis, platformUser);
      const second = await issueWsTicket(fake.redis, platformUser);

      expect(first).not.toBe(second);
    });

    it('should not store fields outside the auth context', async () => {
      const ticket = await issueWsTicket(fake.redis, {
        ...platformUser,
        ...{ accessToken: 'raw-jwt' },
      });

      const stored = fake.store.get(`ws-ticket:${ticket}`);
      expect(stored).toBeDefined();
      expect(stored).not.toContain('raw-jwt');
    });
  });

  describe('consumeWsTicket', () => {
    it.each([
      ['institute', instituteUser],
      ['reseller', resellerUser],
      ['platform', platformUser],
    ])('should return the %s user that the ticket was issued for', async (_scope, user) => {
      const ticket = await issueWsTicket(fake.redis, user);

      const result = await consumeWsTicket(fake.redis, ticket);

      expect(result).toEqual(user);
    });

    it('should keep impersonation and forced-password-change claims', async () => {
      const impersonated: InstituteContext = {
        ...instituteUser,
        mustChangePassword: true,
        isImpersonated: true,
        impersonatorId: 'admin-1',
        impersonationSessionId: 'session-1',
        impersonationReadOnly: true,
      };
      const ticket = await issueWsTicket(fake.redis, impersonated);

      const result = await consumeWsTicket(fake.redis, ticket);

      expect(result).toEqual(impersonated);
    });

    it('should reject a ticket that was already used', async () => {
      const ticket = await issueWsTicket(fake.redis, instituteUser);
      await consumeWsTicket(fake.redis, ticket);

      const second = await consumeWsTicket(fake.redis, ticket);

      expect(second).toBeNull();
    });

    it('should read and delete the ticket in one atomic GETDEL', async () => {
      const ticket = await issueWsTicket(fake.redis, instituteUser);

      await consumeWsTicket(fake.redis, ticket);

      expect(fake.getdel).toHaveBeenCalledTimes(1);
      expect(fake.getdel).toHaveBeenCalledWith(`ws-ticket:${ticket}`);
    });

    it('should reject an unknown or expired ticket', async () => {
      const result = await consumeWsTicket(fake.redis, UNKNOWN_TICKET);

      expect(result).toBeNull();
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['a non-UUID string', 'not-a-ticket'],
      ['a number', 42],
      ['an object', { ticket: UNKNOWN_TICKET }],
    ])('should reject %s without touching Redis', async (_label, ticket) => {
      const result = await consumeWsTicket(fake.redis, ticket);

      expect(result).toBeNull();
      expect(fake.getdel).not.toHaveBeenCalled();
    });

    it('should reject a stored payload that is not valid JSON', async () => {
      fake.store.set(`ws-ticket:${UNKNOWN_TICKET}`, '{not json');

      const result = await consumeWsTicket(fake.redis, UNKNOWN_TICKET);

      expect(result).toBeNull();
    });

    it('should reject a stored institute payload without a tenantId', async () => {
      const { tenantId: _tenantId, ...withoutTenant } = instituteUser;
      fake.store.set(`ws-ticket:${UNKNOWN_TICKET}`, JSON.stringify(withoutTenant));

      const result = await consumeWsTicket(fake.redis, UNKNOWN_TICKET);

      expect(result).toBeNull();
    });
  });
});
