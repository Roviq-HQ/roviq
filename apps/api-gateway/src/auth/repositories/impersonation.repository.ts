import type {
  ExpiredImpersonationSession,
  ImpersonationActorMembership,
  ImpersonationExchangeRows,
  ImpersonationInstitute,
  ImpersonationSessionFilter,
  ImpersonationSessionForEnd,
  ImpersonationSessionList,
  ImpersonationTargetMembership,
  NewImpersonationSession,
  RankedRole,
} from './types';

/** Queries behind ImpersonationService. Every check reads live views as the admin role. */
export abstract class ImpersonationRepository {
  abstract findUserStatus(userId: string): Promise<{ id: string; status: string } | null>;
  /** Active memberships of the user in the institute, oldest first, with their role. */
  abstract findActiveMembershipsWithRole(
    userId: string,
    tenantId: string,
  ): Promise<ImpersonationTargetMembership[]>;
  abstract findInstitute(tenantId: string): Promise<ImpersonationInstitute | null>;
  abstract findInstituteResellerId(tenantId: string): Promise<{ resellerId: string } | null>;
  /** The four reads of a code exchange, in one transaction. */
  abstract findExchangeRows(params: {
    sessionId: string;
    targetUserId: string;
    targetMembershipId: string;
    tenantId: string;
  }): Promise<ImpersonationExchangeRows>;
  abstract findSessionForEnd(sessionId: string): Promise<ImpersonationSessionForEnd | null>;
  /** Closes the session only if it is still open. */
  abstract endSession(sessionId: string, endedAt: Date, endedReason: string): Promise<void>;
  /** Claims every open session past its expiry as `expired` in one UPDATE and returns them. */
  abstract expireOverdueSessions(): Promise<ExpiredImpersonationSession[]>;
  /** Sessions newest first, with display names and impersonator roles, in one transaction. */
  abstract listSessions(filter: ImpersonationSessionFilter): Promise<ImpersonationSessionList>;
  abstract hasActiveResellerMembership(params: {
    membershipId: string;
    userId: string;
    resellerId: string;
  }): Promise<boolean>;
  /** Roles of the user's active memberships in the institute, only while the user is active. */
  abstract findActiveUserRolesInInstitute(userId: string, tenantId: string): Promise<RankedRole[]>;
  abstract findActiveActorMembership(params: {
    membershipId: string;
    userId: string;
    tenantId: string;
  }): Promise<ImpersonationActorMembership | null>;
  abstract hasActiveResellerMembershipOf(userId: string, resellerId: string): Promise<boolean>;
  /** Role abilities of the user's first active platform membership; null when none. */
  abstract findPlatformRoleAbilities(userId: string): Promise<RankedRole['abilities'] | null>;
  /** English role name of the user's first active membership of the reseller; null when none. */
  abstract findResellerRoleName(userId: string, resellerId: string): Promise<string | null>;
  /** Returns the new session id. */
  abstract createSession(session: NewImpersonationSession): Promise<string>;
  /** Longest-standing active institute admin of the institute. */
  abstract findInstituteAdminUserId(tenantId: string): Promise<string | null>;
  abstract findPrimaryPhone(
    userId: string,
  ): Promise<{ countryCode: string; number: string } | null>;
}
