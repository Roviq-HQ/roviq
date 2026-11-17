import { DEFAULT_ROLE_ABILITIES } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AbilityFactory } from '../ability.factory';
import { MembershipAbilityRepository } from '../repositories/membership-ability.repository';
import { RoleRepository } from '../repositories/role.repository';

function createMockRedis() {
  return createMock<Redis>({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  });
}

function createMockRoleRepo() {
  return createMock<RoleRepository>({ findAbilities: vi.fn() });
}

function createMockMembershipAbilityRepo() {
  return createMock<MembershipAbilityRepository>({ findAbilities: vi.fn() });
}

describe('AbilityFactory', () => {
  let factory: AbilityFactory;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockRoleRepo: ReturnType<typeof createMockRoleRepo>;
  let mockMembershipAbilityRepo: ReturnType<typeof createMockMembershipAbilityRepo>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockRoleRepo = createMockRoleRepo();
    mockMembershipAbilityRepo = createMockMembershipAbilityRepo();
    factory = new AbilityFactory(mockRedis, mockRoleRepo, mockMembershipAbilityRepo);
  });

  describe('getRoleAbilities', () => {
    it('should return cached abilities when available', async () => {
      const cachedAbilities = [{ action: 'read', subject: 'Student' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedAbilities));

      const result = await factory.getRoleAbilities('role-1');

      expect(result).toEqual(cachedAbilities);
      expect(mockRoleRepo.findAbilities).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache when not in Redis', async () => {
      const dbAbilities = [{ action: 'manage', subject: 'all' }];
      mockRedis.get.mockResolvedValue(null);
      mockRoleRepo.findAbilities.mockResolvedValue({
        abilities: dbAbilities,
      });

      const result = await factory.getRoleAbilities('role-1');

      expect(result).toEqual(dbAbilities);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'casl:role:role-1',
        JSON.stringify(dbAbilities),
        'EX',
        300,
      );
    });

    it('should return empty array when role not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRoleRepo.findAbilities.mockResolvedValue(null);

      const result = await factory.getRoleAbilities('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('createForUser', () => {
    it('should give a platform user the abilities of its role, not blanket access', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRoleRepo.findAbilities.mockResolvedValue({
        abilities: [
          { action: 'read', subject: 'all' },
          { action: 'impersonate', subject: 'User' },
        ],
      });

      const ability = await factory.createForUser({
        userId: 'support-1',
        scope: 'platform',
        membershipId: 'platform-membership-1',
        roleId: 'platform-support-role',
      });

      expect(mockRoleRepo.findAbilities).toHaveBeenCalledWith('platform-support-role');
      expect(mockMembershipAbilityRepo.findAbilities).not.toHaveBeenCalled();
      expect(ability.can('read', 'Reseller')).toBe(true);
      expect(ability.can('impersonate', 'User')).toBe(true);
      expect(ability.can('create', 'Reseller')).toBe(false);
      expect(ability.can('replay', 'DlqMessage')).toBe(false);
    });

    it('should give a platform user with an unknown role no abilities', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRoleRepo.findAbilities.mockResolvedValue(null);

      const ability = await factory.createForUser({
        userId: 'ghost-1',
        scope: 'platform',
        membershipId: 'platform-membership-2',
        roleId: 'missing-role',
      });

      expect(ability.can('read', 'Reseller')).toBe(false);
    });

    it('uses the selected membership and database assignments instead of token section claims', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify([
          {
            action: 'read',
            subject: 'Student',
            conditions: { sectionId: { $in: '$user.assignedSections' } },
          },
        ]),
      );
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: [] });
      mockMembershipAbilityRepo.findReadAssignments.mockResolvedValue({
        assignedSections: ['assigned-section'],
        linkedStudentIds: [],
      });
      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'selected-membership',
        roleId: 'role-1',
        assignedSections: ['forged-section'],
      });
      expect(mockMembershipAbilityRepo.findAbilities).toHaveBeenCalledWith(
        'selected-membership',
        'tenant-1',
      );
      expect(mockMembershipAbilityRepo.findReadAssignments).toHaveBeenCalledWith(
        'selected-membership',
        'tenant-1',
      );
      expect(ability.rules[0].conditions).toEqual({ sectionId: { $in: ['assigned-section'] } });
    });

    it('should combine role abilities and user abilities', async () => {
      const roleAbilities = [{ action: 'read', subject: 'Student' }];
      const userAbilities = [{ action: 'create', subject: 'Timetable' }];

      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({
        abilities: userAbilities,
      });

      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      expect(ability.can('read', 'Student')).toBe(true);
      expect(ability.can('create', 'Timetable')).toBe(true);
      expect(ability.can('delete', 'Student')).toBe(false);
    });

    it('should work with only role abilities when user has none', async () => {
      const roleAbilities = [{ action: 'manage', subject: 'all' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      expect(ability.can('manage', 'all')).toBe(true);
    });

    it('should resolve ${user.id} placeholders in conditions', async () => {
      const roleAbilities = [
        {
          action: 'read',
          subject: 'Attendance',
          conditions: { studentId: '${user.id}' },
        },
      ];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-42',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      // The condition should be resolved to the actual user ID
      const rules = ability.rules;
      const attendanceRule = rules.find((r) => r.subject === 'Attendance');
      expect(attendanceRule?.conditions).toEqual({ studentId: 'user-42' });
    });

    it('should resolve the default student attendance rule to the caller membership', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(DEFAULT_ROLE_ABILITIES.student));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-42',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      const rule = ability.rules.find((r) => r.subject === 'Attendance');
      expect(rule?.conditions).toEqual({ studentId: 'membership-1' });
    });

    it('should resolve ${user.tenantId} placeholders in conditions', async () => {
      const roleAbilities = [
        {
          action: 'read',
          subject: 'Institute',
          conditions: { id: '${user.tenantId}' },
        },
      ];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-99',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      const rules = ability.rules;
      const instituteRule = rules.find((r) => r.subject === 'Institute');
      expect(instituteRule?.conditions).toEqual({ id: 'tenant-99' });
    });

    it('should resolve multiple placeholders in nested conditions', async () => {
      const roleAbilities = [
        {
          action: 'read',
          subject: 'Attendance',
          conditions: {
            studentId: '${user.id}',
            institute: { id: '${user.tenantId}' },
          },
        },
      ];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-42',
        scope: 'institute',
        tenantId: 'tenant-99',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      const rule = ability.rules.find((r) => r.subject === 'Attendance');
      expect(rule?.conditions).toEqual({
        studentId: 'user-42',
        institute: { id: 'tenant-99' },
      });
    });

    it('should handle user record not found gracefully', async () => {
      const roleAbilities = [{ action: 'read', subject: 'Student' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue(null);

      const ability = await factory.createForUser({
        userId: 'deleted-user',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      expect(ability.can('read', 'Student')).toBe(true);
      expect(ability.rules).toHaveLength(1);
    });

    it('should treat user abilities as empty array when field is null', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify([{ action: 'read', subject: 'Student' }]));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      expect(ability.rules).toHaveLength(1);
    });

    it('should propagate Redis connection errors', async () => {
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        factory.createForUser({
          userId: 'user-1',
          scope: 'institute',
          tenantId: 'tenant-1',
          membershipId: 'membership-1',
          roleId: 'role-1',
        }),
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('should pass through rules without conditions unchanged', async () => {
      const roleAbilities = [{ action: 'read', subject: 'Student' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(roleAbilities));
      mockMembershipAbilityRepo.findAbilities.mockResolvedValue({ abilities: null });

      const ability = await factory.createForUser({
        userId: 'user-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        roleId: 'role-1',
      });

      expect(ability.rules[0].conditions).toBeUndefined();
    });
  });

  describe('invalidateRoleCache', () => {
    it('should delete the cached role from Redis', async () => {
      await factory.invalidateRoleCache('role-1');

      expect(mockRedis.del).toHaveBeenCalledWith('casl:role:role-1');
    });
  });
});
