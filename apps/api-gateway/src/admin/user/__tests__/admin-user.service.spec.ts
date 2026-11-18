import { BusinessException, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminUserService } from '../admin-user.service';
import { AdminUserRepository } from '../repositories/admin-user.repository';
import type { AdminUserRecord } from '../repositories/types';

function buildUser(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    email: 'rajesh@example.test',
    username: 'rajesh.kumar',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    lastActiveAt: null,
    primaryPhone: null,
    profile: null,
    memberships: [],
    ...overrides,
  };
}

describe('AdminUserService', () => {
  describe('list', () => {
    it('should default the page size and take page cursors from the first and last edge', async () => {
      const edges = [
        { node: buildUser(), cursor: 'c1' },
        { node: buildUser({ id: '019a0000-0000-7000-8000-000000000002' }), cursor: 'c2' },
      ];
      const repo = createMock<AdminUserRepository>({
        list: vi.fn().mockResolvedValue({ edges, hasNextPage: true, totalCount: 42 }),
      });
      const service = new AdminUserService(repo);

      const result = await service.list({ status: [] });

      expect(repo.list).toHaveBeenCalledWith({ status: [], first: 20 });
      expect(result).toEqual({
        edges,
        totalCount: 42,
        pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c2' },
      });
    });

    it('should report a previous page when called with a cursor', async () => {
      const repo = createMock<AdminUserRepository>({
        list: vi.fn().mockResolvedValue({ edges: [], hasNextPage: false, totalCount: 0 }),
      });
      const service = new AdminUserService(repo);

      const result = await service.list({ first: 5, after: 'abc' });

      expect(repo.list).toHaveBeenCalledWith({ first: 5, after: 'abc' });
      expect(result.pageInfo).toEqual({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: undefined,
        endCursor: undefined,
      });
    });
  });

  describe('getUser', () => {
    it('should throw NOT_FOUND when the user does not exist', async () => {
      const repo = createMock<AdminUserRepository>({
        findDetail: vi.fn().mockResolvedValue(null),
      });
      const service = new AdminUserService(repo);

      const error = await service.getUser('019a0000-0000-7000-8000-000000000009').catch((e) => e);

      expect(error).toBeInstanceOf(BusinessException);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('statistics', () => {
    it('should ask the repository for counts relative to now', async () => {
      vi.useFakeTimers({ now: new Date('2026-11-18T12:00:00.000Z') });
      const stats = { totalUsers: 9, activeThisMonth: 4, newThisWeek: 2, multiInstituteUsers: 1 };
      const repo = createMock<AdminUserRepository>({
        statistics: vi.fn().mockResolvedValue(stats),
      });
      const service = new AdminUserService(repo);

      await expect(service.statistics()).resolves.toEqual(stats);
      expect(repo.statistics).toHaveBeenCalledWith(new Date('2026-11-18T12:00:00.000Z'));
      vi.useRealTimers();
    });
  });
});
