/**
 * ROV-170 — Unit tests for GroupService CRUD + rule-engine wiring.
 *
 * Pure unit: mocks the group repository, `@roviq/groups` (rule interpreter) and the request
 * context. Verifies the service forwards rules to the interpreter and hands the insert payload
 * for dynamic groups to the repository.
 */
import {
  DomainGroupType,
  DynamicGroupStatus,
  ErrorCode,
  GroupMembershipType,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupRepository } from '../repositories/group.repository';
import type { GroupRecord } from '../repositories/types';

vi.mock('@roviq/groups', () => ({
  extractDimensions: vi.fn((_rule: unknown) => ['academic_status']),
  groupRuleToDrizzleSql: vi.fn(() => ({ __sql: 'mocked' })),
}));

vi.mock('@roviq/request-context', () => ({
  getRequestContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

import { extractDimensions } from '@roviq/groups';
// Import AFTER mocks.
import { GroupService } from '../group.service';

function groupRecord(overrides: Partial<GroupRecord>): GroupRecord {
  return {
    id: 'grp',
    tenantId: 'tenant-1',
    name: 'Group',
    description: null,
    groupType: DomainGroupType.CUSTOM,
    membershipType: GroupMembershipType.DYNAMIC,
    memberTypes: ['student'],
    isSystem: false,
    status: DynamicGroupStatus.ACTIVE,
    resolvedAt: null,
    memberCount: 0,
    parentGroupId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
    version: 1,
    ...overrides,
  };
}

describe('GroupService (unit)', () => {
  let service: GroupService;
  let repo: GroupRepository;
  let eventBus: EventBusService;

  beforeEach(() => {
    vi.mocked(extractDimensions).mockClear();
    repo = createMock<GroupRepository>();
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    service = new GroupService(repo, eventBus);
  });

  it('create inserts a dynamic group and delegates rule dimensions to extractDimensions', async () => {
    vi.mocked(repo.create).mockResolvedValue(
      groupRecord({ id: 'grp-1', name: 'Class 5 enrolled' }),
    );

    const rule = { '==': [{ var: 'academic_status' }, 'enrolled'] };
    const result = await service.create({
      name: 'Class 5 enrolled',
      groupType: DomainGroupType.CUSTOM,
      membershipType: GroupMembershipType.DYNAMIC,
      memberTypes: ['student'],
      rule,
    });

    expect(result.id).toBe('grp-1');
    expect(extractDimensions).toHaveBeenCalledWith(rule);
    expect(repo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      name: 'Class 5 enrolled',
      description: null,
      groupType: DomainGroupType.CUSTOM,
      membershipType: GroupMembershipType.DYNAMIC,
      memberTypes: ['student'],
      isSystem: false,
      parentGroupId: null,
      rule: { rule, ruleDimensions: ['academic_status'], description: null },
      childGroupIds: [],
      memberMembershipIds: [],
    });
  });

  it('create without a rule skips the groupRules insert entirely', async () => {
    vi.mocked(repo.create).mockResolvedValue(
      groupRecord({ id: 'grp-2', name: 'Static club', groupType: DomainGroupType.CLUB }),
    );

    await service.create({
      name: 'Static club',
      groupType: DomainGroupType.CLUB,
      membershipType: GroupMembershipType.STATIC,
    });

    expect(vi.mocked(repo.create).mock.calls[0]?.[0].rule).toBeNull();
    expect(extractDimensions).not.toHaveBeenCalled();
  });

  it('findById rejects when no row is returned', async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toMatchObject({
      code: ErrorCode.GROUP_NOT_FOUND,
    });
  });
});
