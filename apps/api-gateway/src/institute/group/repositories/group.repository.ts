import type { JsonLogicRule } from '@roviq/groups';
import type {
  CreateGroupData,
  GroupListQuery,
  GroupMemberListRow,
  GroupMemberRow,
  GroupRecord,
  GroupRuleData,
  GroupUpdate,
  MembershipUserRow,
  RulePreview,
  UserNameRow,
} from './types';

export abstract class GroupRepository {
  /** Group, its rule and its composite children, in one transaction. */
  /** Null when the parent or a child group is not a group of the institute. */
  abstract create(data: CreateGroupData): Promise<GroupRecord | null>;
  abstract findById(tenantId: string, id: string): Promise<GroupRecord | null>;
  /** Ordered by name. */
  abstract list(tenantId: string, query: GroupListQuery): Promise<GroupRecord[]>;
  /**
   * Replaces the rule (when given) and updates the group in one transaction; null when no live
   * group matched.
   */
  abstract update(
    tenantId: string,
    id: string,
    actorId: string,
    updates: GroupUpdate,
    rule: GroupRuleData | null,
  ): Promise<GroupRecord | null>;
  /** False when no live group matched. */
  abstract softDelete(tenantId: string, id: string, actorId: string): Promise<boolean>;
  /** Members not excluded. */
  abstract countActiveMembers(tenantId: string, groupId: string): Promise<number>;
  abstract setResolution(
    tenantId: string,
    groupId: string,
    memberCount: number,
    resolvedAt: Date,
    actorId: string,
  ): Promise<void>;
  /** Membership ids of the students matching any of the group's rules. */
  abstract findRuleMatches(tenantId: string, groupId: string): Promise<string[]>;
  /** Members of every child group, up to five levels down. */
  abstract findCompositeMembers(tenantId: string, groupId: string): Promise<string[]>;
  abstract listExcludedMembershipIds(tenantId: string, groupId: string): Promise<string[]>;
  abstract listManualMembershipIds(tenantId: string, groupId: string): Promise<string[]>;
  /**
   * Tombstones rule members no longer matching, adds the new ones and stores the count, in one
   * transaction.
   */
  abstract syncRuleMembers(
    tenantId: string,
    groupId: string,
    actorId: string,
    matchingMembershipIds: string[],
  ): Promise<void>;
  /** Count and up to ten sample membership ids; writes nothing. */
  abstract previewRule(tenantId: string, rule: JsonLogicRule): Promise<RulePreview>;
  /** Excluded members last. */
  abstract listMemberRows(tenantId: string, groupId: string): Promise<GroupMemberListRow[]>;
  abstract findMembershipUsers(
    tenantId: string,
    membershipIds: string[],
  ): Promise<MembershipUserRow[]>;
  /** Platform-level user names for user ids read from this institute's memberships. */
  abstract findUserNames(tenantId: string, userIds: string[]): Promise<UserNameRow[]>;
  /** Null when the member is not in the group. */
  abstract setMemberExcluded(
    tenantId: string,
    groupId: string,
    memberId: string,
    excluded: boolean,
    actorId: string,
  ): Promise<GroupMemberRow | null>;
  /** Recounts the active members and stores the count, in one transaction. */
  abstract refreshMemberCount(
    tenantId: string,
    groupId: string,
    resolvedAt: Date,
    actorId: string,
  ): Promise<number>;
}
