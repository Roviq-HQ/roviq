import type { ResellerTier } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

export interface TeamMemberRecord {
  /** reseller_memberships.id */
  id: string;
  userId: string;
  email: string;
  username: string;
  roleId: string;
  isActive: boolean;
  joinedAt: Date;
  profile: {
    firstName: I18nContent;
    lastName: I18nContent | null;
    profileImageFileId: string | null;
  } | null;
}

export interface TeamRoleRecord {
  id: string;
  name: I18nContent;
}

export interface TeamSessionRecord {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

export interface TeamListQuery {
  search?: string;
  isActive?: boolean;
  first: number;
  afterId?: string;
}

export abstract class ResellerTeamRepository {
  abstract list(
    resellerId: string,
    query: TeamListQuery,
  ): Promise<{ rows: TeamMemberRecord[]; totalCount: number }>;
  abstract findMember(resellerId: string, membershipId: string): Promise<TeamMemberRecord | null>;
  abstract findMemberByUser(resellerId: string, userId: string): Promise<TeamMemberRecord | null>;
  abstract findTier(resellerId: string): Promise<ResellerTier | null>;
  /** The reseller's own reseller-scope roles. */
  abstract listRoles(resellerId: string): Promise<TeamRoleRecord[]>;
  /** Latest sign-in activity per user; only for users already known to be this reseller's staff. */
  abstract findLastActive(userIds: string[]): Promise<Map<string, Date>>;
  /** Live sessions of one membership; only for a membership already known to be this reseller's. */
  abstract listSessions(membershipId: string): Promise<TeamSessionRecord[]>;
  abstract updateRole(
    resellerId: string,
    membershipId: string,
    roleId: string,
    actorId: string,
  ): Promise<void>;
  abstract setActive(
    resellerId: string,
    membershipId: string,
    isActive: boolean,
    actorId: string,
  ): Promise<void>;
}
