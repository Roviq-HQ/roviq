import type {
  CreateInstituteGroupData,
  GroupMembershipRecord,
  InstituteGroupRecord,
  InstituteGroupSearchParams,
  UpdateInstituteGroupData,
} from './types';

export abstract class InstituteGroupRepository {
  abstract findById(id: string): Promise<InstituteGroupRecord | null>;
  /** The group the tenant's own institute belongs to, read under tenant RLS. */
  abstract findForTenant(tenantId: string): Promise<InstituteGroupRecord | null>;
  abstract search(
    params: InstituteGroupSearchParams,
  ): Promise<{ records: InstituteGroupRecord[]; total: number }>;
  /** Groups the reseller owns or that contain its institutes, read under reseller RLS. */
  abstract searchForReseller(
    resellerId: string,
    params: InstituteGroupSearchParams,
  ): Promise<{ records: InstituteGroupRecord[]; total: number }>;
  abstract create(data: CreateInstituteGroupData): Promise<InstituteGroupRecord>;
  abstract update(id: string, data: UpdateInstituteGroupData): Promise<InstituteGroupRecord>;
  abstract updateStatus(id: string, status: string): Promise<InstituteGroupRecord>;
  abstract softDelete(id: string): Promise<void>;

  /** Count institutes per group (for list views) */
  abstract countInstitutesByGroup(groupIds: string[]): Promise<Record<string, number>>;

  /** Same count, limited to the reseller's own institutes. */
  abstract countInstitutesByGroupForReseller(
    resellerId: string,
    groupIds: string[],
  ): Promise<Record<string, number>>;

  // Institute <-> Group linking
  abstract addInstituteToGroup(instituteId: string, groupId: string): Promise<void>;
  abstract removeInstituteFromGroup(instituteId: string): Promise<void>;

  /** Links one of the reseller's institutes to a group the reseller owns. */
  abstract addInstituteToGroupForReseller(
    resellerId: string,
    instituteId: string,
    groupId: string,
  ): Promise<void>;
  /** Unlinks one of the reseller's institutes from a group the reseller owns. */
  abstract removeInstituteFromGroupForReseller(
    resellerId: string,
    instituteId: string,
  ): Promise<void>;

  // Group memberships
  abstract addMember(
    groupId: string,
    userId: string,
    roleId: string,
  ): Promise<GroupMembershipRecord>;
  abstract removeMember(groupId: string, userId: string): Promise<void>;
  abstract findMembershipsByGroup(groupId: string): Promise<GroupMembershipRecord[]>;
  abstract findMembershipsByUser(userId: string): Promise<GroupMembershipRecord[]>;
}
