import { Injectable, Logger } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { CreateInstituteGroupInput } from './dto/create-institute-group.input';
import type { InstituteGroupFilterInput } from './dto/institute-group-filter.input';
import type { UpdateInstituteGroupInput } from './dto/update-institute-group.input';
import { InstituteGroupRepository } from './repositories/institute-group.repository';
import type { GroupMembershipRecord, InstituteGroupRecord } from './repositories/types';

@Injectable()
export class InstituteGroupService {
  private readonly logger = new Logger(InstituteGroupService.name);

  constructor(
    private readonly groupRepo: InstituteGroupRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** Every group, with its institute count (platform scope). */
  async searchWithInstituteCounts(filter: InstituteGroupFilterInput) {
    const { records, total } = await this.groupRepo.search(toSearchParams(filter));
    const nodes = records.slice(0, pageSize(filter));
    const counts = await this.groupRepo.countInstitutesByGroup(nodes.map((r) => r.id));
    return toConnection(filter, records, total, counts);
  }

  /** Groups the reseller owns or that contain its institutes, counting only its own institutes. */
  async searchForReseller(resellerId: string, filter: InstituteGroupFilterInput) {
    const { records, total } = await this.groupRepo.searchForReseller(
      resellerId,
      toSearchParams(filter),
    );
    const nodes = records.slice(0, pageSize(filter));
    const counts = await this.groupRepo.countInstitutesByGroupForReseller(
      resellerId,
      nodes.map((r) => r.id),
    );
    return toConnection(filter, records, total, counts);
  }

  async findById(id: string): Promise<InstituteGroupRecord> {
    const record = await this.groupRepo.findById(id);
    if (!record) {
      throw new BusinessException(
        ErrorCode.INSTITUTE_GROUP_NOT_FOUND,
        `Institute group ${id} not found`,
      );
    }
    return record;
  }

  async findForTenant(tenantId: string): Promise<InstituteGroupRecord | null> {
    return this.groupRepo.findForTenant(tenantId);
  }

  /** `resellerId` is the owning reseller, or null for a platform-managed group. */
  async create(
    input: CreateInstituteGroupInput,
    resellerId: string | null,
  ): Promise<InstituteGroupRecord> {
    const group = await this.groupRepo.create({ ...input, resellerId });

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.created, { id: group.id, name: group.name });
    return group;
  }

  async update(id: string, input: UpdateInstituteGroupInput): Promise<InstituteGroupRecord> {
    await this.requireGroup(id);
    const group = await this.groupRepo.update(id, input);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.updated, { id: group.id });
    return group;
  }

  async activate(id: string): Promise<InstituteGroupRecord> {
    await this.requireGroup(id);
    const group = await this.groupRepo.updateStatus(id, 'ACTIVE');

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.activated, { id: group.id });
    return group;
  }

  async deactivate(id: string): Promise<InstituteGroupRecord> {
    await this.requireGroup(id);
    const group = await this.groupRepo.updateStatus(id, 'INACTIVE');

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.deactivated, { id: group.id });
    return group;
  }

  async suspend(id: string): Promise<InstituteGroupRecord> {
    await this.requireGroup(id);
    const group = await this.groupRepo.updateStatus(id, 'SUSPENDED');

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.suspended, { id: group.id });
    return group;
  }

  async delete(id: string): Promise<boolean> {
    await this.requireGroup(id);
    await this.groupRepo.softDelete(id);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.deleted, { id });
    return true;
  }

  async addInstituteToGroup(instituteId: string, groupId: string): Promise<boolean> {
    await this.requireGroup(groupId);
    await this.groupRepo.addInstituteToGroup(instituteId, groupId);

    // Warn if group's institutes now span multiple resellers (application-level check)
    await this.warnIfMultiReseller(groupId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.institute_added, { groupId, instituteId });
    return true;
  }

  /** Log a warning if a group's institutes belong to different resellers */
  private async warnIfMultiReseller(groupId: string): Promise<void> {
    const counts = await this.groupRepo.countInstitutesByGroup([groupId]);
    if ((counts[groupId] ?? 0) > 1) {
      this.logger.warn(
        `Institute group ${groupId} has institutes from potentially different resellers — verify assignment`,
      );
    }
  }

  async removeInstituteFromGroup(instituteId: string): Promise<boolean> {
    await this.groupRepo.removeInstituteFromGroup(instituteId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.institute_removed, { instituteId });
    return true;
  }

  /** Throws unless the reseller owns the group; another owner's group reads as not found. */
  async assertOwnedByReseller(resellerId: string, groupId: string): Promise<void> {
    const group = await this.groupRepo.findOwnedByReseller(resellerId, groupId);
    if (!group) {
      throw new BusinessException(
        ErrorCode.INSTITUTE_GROUP_NOT_FOUND,
        `Institute group ${groupId} not found`,
      );
    }
  }

  async addInstituteToGroupForReseller(
    resellerId: string,
    instituteId: string,
    groupId: string,
  ): Promise<boolean> {
    await this.groupRepo.addInstituteToGroupForReseller(resellerId, instituteId, groupId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.institute_added, { groupId, instituteId });
    return true;
  }

  async removeInstituteFromGroupForReseller(
    resellerId: string,
    instituteId: string,
  ): Promise<boolean> {
    await this.groupRepo.removeInstituteFromGroupForReseller(resellerId, instituteId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.institute_removed, { instituteId });
    return true;
  }

  async addMember(groupId: string, userId: string, roleId: string): Promise<GroupMembershipRecord> {
    await this.requireGroup(groupId);
    const membership = await this.groupRepo.addMember(groupId, userId, roleId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.member_added, { groupId, userId });
    return membership;
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    await this.requireGroup(groupId);
    await this.groupRepo.removeMember(groupId, userId);

    this.eventBus.emit(EVENT_PATTERNS.INSTITUTE.group.member_removed, { groupId, userId });
    return true;
  }

  async findMyGroups(userId: string): Promise<GroupMembershipRecord[]> {
    const records = await this.groupRepo.findMembershipsByUser(userId);
    return records;
  }

  private async requireGroup(id: string) {
    const record = await this.groupRepo.findById(id);
    if (!record) {
      throw new BusinessException(
        ErrorCode.INSTITUTE_GROUP_NOT_FOUND,
        `Institute group ${id} not found`,
      );
    }
    return record;
  }
}

function pageSize(filter: InstituteGroupFilterInput): number {
  return filter.first ?? 20;
}

function toSearchParams(filter: InstituteGroupFilterInput) {
  return {
    search: filter.search,
    status: filter.status,
    type: filter.type,
    first: pageSize(filter) + 1, // one extra row tells us whether a next page exists
    after: filter.after,
  };
}

function toConnection(
  filter: InstituteGroupFilterInput,
  records: InstituteGroupRecord[],
  total: number,
  counts: Record<string, number>,
) {
  const limit = pageSize(filter);
  const edges = records.slice(0, limit).map((record) => ({
    node: { ...record, instituteCount: counts[record.id] ?? 0 },
    cursor: encodeCursor({ id: record.id }),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage: records.length > limit,
      hasPreviousPage: !!filter.after,
      startCursor: edges[0]?.cursor,
      endCursor: edges[edges.length - 1]?.cursor,
    },
    totalCount: total,
  };
}
