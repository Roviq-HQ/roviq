import type { MembershipStatus } from '@roviq/common-types';
import type { institutes, memberships, roles, userProfiles, users } from '@roviq/database';

export interface ResellerUserListQuery {
  search?: string;
  instituteId?: string;
  membershipStatus?: MembershipStatus[];
  /** Keyset cursor: only users with an id above this one. */
  afterId?: string;
  limit: number;
}

type UserRow = typeof users.$inferSelect;
type ProfileRow = typeof userProfiles.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;

export interface ResellerUserRow
  extends Pick<UserRow, 'id' | 'email' | 'username' | 'status' | 'createdAt'> {
  /** Null when the user has no profile (left join). */
  firstName: ProfileRow['firstName'] | null;
  lastName: ProfileRow['lastName'] | null;
  profileImageFileId: ProfileRow['profileImageFileId'] | null;
}

export interface ResellerUserMembershipRow
  extends Pick<MembershipRow, 'id' | 'userId' | 'tenantId' | 'roleId' | 'status'> {
  roleName: (typeof roles.$inferSelect)['name'];
  instituteName: (typeof institutes.$inferSelect)['name'];
}

export interface ResellerUserListResult {
  totalCount: number;
  hasNextPage: boolean;
  /** At most `limit` users, oldest first. */
  nodes: ResellerUserRow[];
  /** Memberships of `nodes` in this reseller's institutes. */
  memberships: ResellerUserMembershipRow[];
}
