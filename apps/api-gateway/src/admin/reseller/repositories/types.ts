import type { ResellerStatus, ResellerSystemRoleName, ResellerTier } from '@roviq/common-types';
import type { resellerMemberships, resellers, roles, userProfiles, users } from '@roviq/database';

export type ResellerRecord = typeof resellers.$inferSelect;
export type ResellerPatch = Partial<typeof resellers.$inferInsert>;
export type ResellerSystemRoleIds = Record<ResellerSystemRoleName, string>;

export interface AdminResellerListQuery {
  status?: ResellerStatus[];
  tier?: ResellerTier[];
  isSystem?: boolean;
  search?: string;
  /** Keyset cursor on (created_at DESC, id DESC), already validated. */
  after?: { createdAt: string; id: string };
  /** Rows to fetch (page size + 1 to detect a next page). */
  limit: number;
}

export interface AdminResellerTeamMemberRow {
  id: string;
  userId: string;
  username: (typeof users.$inferSelect)['username'];
  email: (typeof users.$inferSelect)['email'];
  firstName: (typeof userProfiles.$inferSelect)['firstName'] | null;
  lastName: (typeof userProfiles.$inferSelect)['lastName'] | null;
  roleName: (typeof roles.$inferSelect)['name'] | null;
  isActive: (typeof resellerMemberships.$inferSelect)['isActive'];
  joinedAt: Date;
  lastActiveAt: Date | null;
}

export interface CreateResellerData {
  name: string;
  slug: string;
  tier: ResellerTier;
  branding: ResellerRecord['branding'];
  customDomain: string | null;
  actorId: string;
}

export interface ResellerMemberRole {
  id: string;
  roleId: string;
  /** English name of the member's role. */
  roleName: string;
}

export interface MemberRoleMove {
  id: string;
  roleId: string;
}

export interface ResellerTierChangeRules {
  /** Throws to refuse; 'skip' ends the transaction without writing. */
  decide(existing: ResellerRecord): 'skip' | 'apply';
  /** The memberships whose role must change for the new tier. */
  planMoves(
    existing: ResellerRecord,
    members: ResellerMemberRole[],
    roleIds: ResellerSystemRoleIds,
  ): MemberRoleMove[];
}

export type ResellerNotFound = { kind: 'not_found' };

export type ResellerUpdateResult =
  | ResellerNotFound
  | { kind: 'conflict' }
  | { kind: 'ok'; record: ResellerRecord };

export type ResellerTierChangeResult =
  | ResellerNotFound
  | { kind: 'ok'; record: ResellerRecord; oldTier: ResellerTier; moved: MemberRoleMove[] };

export type ResellerSuspendResult =
  | ResellerNotFound
  | {
      kind: 'ok';
      record: ResellerRecord;
      previousStatus: ResellerRecord['status'];
      staffUserIds: string[];
      endedSessionIds: string[];
    };

export type ResellerUnsuspendResult = ResellerNotFound | { kind: 'ok'; record: ResellerRecord };

export type ResellerDeleteResult =
  | ResellerNotFound
  | { kind: 'ok'; record: ResellerRecord; affectedInstituteIds: string[] };

export interface ResellerCounts {
  instituteCount: Map<string, number>;
  teamSize: Map<string, number>;
}
