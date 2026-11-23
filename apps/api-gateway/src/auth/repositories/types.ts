import type { AbilityRule } from '@roviq/common-types';
import type {
  authEvents,
  I18nContent,
  impersonationSessions,
  memberships,
  users,
} from '@roviq/database';
import type { RefreshTokenRevokeReason } from './refresh-token.repository';

type UserStatus = (typeof users.$inferSelect)['status'];
type MembershipStatus = (typeof memberships.$inferSelect)['status'];

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  passwordChangedAt: Date | null;
  /** ROV-96 — first-login enforcement. True when an admin-created user has never rotated their temp password. */
  mustChangePassword: boolean;
  emailVerifiedAt: Date | null;
  tokenVersion: number;
}

export interface InstituteInfo {
  id: string;
  name: I18nContent;
  slug: string;
  logoUrl: string | null;
  /**
   * The reseller that owns this institute. Read at JWT mint time so
   * institute-scope tokens carry `resellerId` — required for EE billing
   * operations gated by `assertInstituteWithReseller` (myInvoices,
   * assignPlan, cancelSubscription, etc.). Always populated because
   * `institutes.reseller_id` is NOT NULL with a default of RESELLER_DIRECT.
   */
  resellerId: string;
}

export interface RoleInfo {
  id: string;
  name: I18nContent;
  abilities: unknown;
}

export interface MembershipWithInstituteAndRole {
  id: string;
  tenantId: string;
  roleId: string;
  status: MembershipStatus;
  abilities: unknown;
  institute: InstituteInfo;
  role: RoleInfo;
}

export interface PlatformMembershipWithRole {
  id: string;
  userId: string;
  roleId: string;
  isActive: boolean;
  abilities: unknown;
  role: Pick<RoleInfo, 'id' | 'abilities'>;
}

export interface ResellerMembershipWithResellerAndRole {
  id: string;
  userId: string;
  resellerId: string;
  roleId: string;
  isActive: boolean;
  abilities: unknown;
  reseller: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    status: string;
  };
  role: Pick<RoleInfo, 'id' | 'abilities'>;
}

export interface CreateRefreshTokenData {
  id: string;
  tokenHash: string;
  userId: string;
  tenantId: string | null;
  membershipId: string;
  membershipScope: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
}

export interface RefreshTokenWithRelations {
  id: string;
  tokenHash: string;
  userId: string;
  membershipScope: string;
  revokedAt: Date | null;
  /**
   * Why `revokedAt` was set. `null` on live tokens and on legacy rows
   * written before the column existed. Read by the refresh flow to
   * distinguish genuine reuse (`rotation`) from deliberate revocation
   * (`user_initiated`, `password_change`, `admin_revoked`) — only the
   * rotation path triggers the "family kill" cascade.
   */
  revokedReason: RefreshTokenRevokeReason | null;
  expiresAt: Date;
  createdAt: Date;
  deviceInfo: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastUsedAt: Date | null;
  user: Omit<UserRecord, 'passwordHash'>;
  membership: {
    id: string;
    tenantId: string;
    roleId: string;
    abilities: unknown;
    role: Pick<RoleInfo, 'id' | 'abilities'>;
    /**
     * Joined institute info — required so the refresh flow can mint a new
     * institute-scope JWT containing `resellerId` (ROV-261) without an
     * extra round-trip to `membershipRepo`.
     */
    institute: Omit<InstituteInfo, 'logoUrl'>;
  } | null;
}

// ── IdentityRepository ────────────────────────────────────

export interface UserEmailMatch {
  id: string;
  deletedAt: Date | null;
  emailVerifiedAt: Date | null;
  createdBy: string;
}

export interface UserContactRow {
  email: string;
  username: string;
  mustChangePassword: boolean;
  firstName: Record<string, string> | null;
  lastName: Record<string, string> | null;
  phone: { countryCode: string; number: string } | null;
}

export interface NewUserProfile {
  userId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
  actorId: string;
}

export interface NewUserRecord {
  email: string;
  username: string;
  /** Already hashed by the service. */
  passwordHash: string;
  actorId: string;
}

export interface NewUserPhone {
  userId: string;
  countryCode: string;
  number: string;
  actorId: string;
}

export interface NewInstituteMembership {
  userId: string;
  tenantId: string;
  roleId: string;
  abilities: AbilityRule[];
  actorId: string;
}

export interface NewResellerMembership {
  userId: string;
  resellerId: string;
  roleId: string;
  abilities: AbilityRule[];
  actorId: string;
}

export interface NewPlatformMembership {
  userId: string;
  roleId: string;
  abilities: AbilityRule[];
  actorId: string;
}

// ── AuthEventRepository ───────────────────────────────────

export type NewAuthEventRecord = Omit<typeof authEvents.$inferInsert, 'id' | 'createdAt'>;

// ── ImpersonationRepository ───────────────────────────────

export type NewImpersonationSession = Omit<
  typeof impersonationSessions.$inferInsert,
  'id' | 'endedAt' | 'endedReason'
>;

/** A role as the rank rule sees it: English name and abilities. */
export interface RankedRole {
  name: string;
  abilities: AbilityRule[];
}

export interface ImpersonationTargetMembership {
  id: string;
  roleName: string;
  roleAbilities: AbilityRule[];
}

export interface ImpersonationInstitute {
  id: string;
  resellerId: string;
  requireImpersonationConsent: boolean;
}

export interface ImpersonationActorMembership {
  id: string;
  roleId: string;
  roleName: string;
  roleAbilities: AbilityRule[];
}

/** Everything the code exchange reads, from one transaction; null where no row matched. */
export interface ImpersonationExchangeRows {
  targetUser: {
    id: string;
    username: string;
    firstName: I18nContent | null;
    lastName: I18nContent | null;
  } | null;
  membership: { id: string; tenantId: string; roleId: string } | null;
  session: {
    id: string;
    impersonatorId: string;
    impersonatorScope: string;
    endedAt: Date | null;
    expiresAt: Date;
  } | null;
  institute: { id: string; name: I18nContent; resellerId: string } | null;
}

export interface ImpersonationSessionForEnd {
  id: string;
  impersonatorId: string;
  impersonatorScope: string;
  targetUserId: string;
  targetTenantId: string | null;
  endedAt: Date | null;
}

export interface ExpiredImpersonationSession {
  id: string;
  impersonatorId: string;
  impersonatorScope: string;
  targetTenantId: string | null;
}

export interface ImpersonationSessionListRow {
  id: string;
  impersonatorId: string;
  impersonatorScope: string;
  impersonatorName: string | null;
  targetUserId: string;
  targetUserName: string | null;
  targetTenantId: string | null;
  targetTenantName: I18nContent | null;
  reason: string;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
  otpVerified: Date | null;
  otpVerifiedByName: string | null;
}

/** Impersonator role names: platform and reseller keyed by user id, institute by `${userId}:${tenantId}`. */
export interface ImpersonatorRoleNames {
  platform: Map<string, I18nContent>;
  reseller: Map<string, I18nContent>;
  institute: Map<string, I18nContent>;
}

export interface ImpersonationSessionList {
  rows: ImpersonationSessionListRow[];
  roles: ImpersonatorRoleNames;
}

export interface ImpersonationSessionFilter {
  resellerId?: string;
  sessionId?: string;
  activeOnly?: boolean;
  limit: number;
}
