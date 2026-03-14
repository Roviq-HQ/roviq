export interface UserRecord {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

export interface CreateUserData {
  username: string;
  email: string;
  passwordHash: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface RoleInfo {
  id: string;
  name: string;
  abilities: unknown;
}

export interface MembershipWithOrgAndRole {
  id: string;
  tenantId: string;
  roleId: string;
  isActive: boolean;
  abilities: unknown;
  organization: OrgInfo;
  role: RoleInfo;
}

export interface MembershipWithRole {
  id: string;
  tenantId: string;
  roleId: string;
  isActive: boolean;
  abilities: unknown;
  role: Pick<RoleInfo, 'id' | 'abilities'>;
}

export interface CreateRefreshTokenData {
  id: string;
  tokenHash: string;
  userId: string;
  tenantId: string;
  membershipId?: string;
  expiresAt: Date;
}

export interface RefreshTokenWithRelations {
  id: string;
  tokenHash: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  user: UserRecord;
  membership: {
    id: string;
    tenantId: string;
    roleId: string;
    abilities: unknown;
    role: Pick<RoleInfo, 'id' | 'abilities'>;
  } | null;
}
