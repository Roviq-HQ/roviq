import type {
  DomainGroupType,
  DynamicGroupStatus,
  GroupMemberSource,
  GroupMembershipType,
} from '@roviq/common-types';
import type { groupMembers, groupRules, groups, I18nContent } from '@roviq/database';

export type GroupRecord = typeof groups.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;

type RuleInsert = typeof groupRules.$inferInsert;

export interface GroupRuleData {
  rule: RuleInsert['rule'];
  ruleDimensions: RuleInsert['ruleDimensions'];
  description: string | null;
}

export interface CreateGroupData {
  tenantId: string;
  actorId: string;
  name: string;
  description: string | null;
  groupType: DomainGroupType;
  membershipType: GroupMembershipType;
  memberTypes: string[];
  isSystem: boolean;
  parentGroupId: string | null;
  /** Null when the group has no rule. */
  rule: GroupRuleData | null;
  childGroupIds: string[];
}

export interface GroupListQuery {
  groupType?: DomainGroupType;
  membershipType?: GroupMembershipType;
  status?: DynamicGroupStatus;
  search?: string;
}

/** Changed group fields only; `resolvedAt: null` invalidates the last resolution. */
export interface GroupUpdate {
  name?: string;
  description?: string;
  status?: DynamicGroupStatus;
  resolvedAt?: null;
}

export interface GroupMemberListRow {
  id: string;
  groupId: string;
  membershipId: string;
  source: GroupMemberSource;
  isExcluded: boolean;
  resolvedAt: Date | null;
}

export interface MembershipUserRow {
  id: string;
  userId: string;
}

export interface UserNameRow {
  id: string;
  username: string;
  email: string;
}

export interface RulePreviewMember {
  membershipId: string;
  firstName: I18nContent;
  lastName: I18nContent | null;
  admissionNumber: string;
}

export interface RulePreview {
  count: number;
  sampleMembershipIds: string[];
  sampleMembers: RulePreviewMember[];
}
