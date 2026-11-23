import type { ResellerTier } from '@roviq/common-types';
import type {
  AdminResellerListQuery,
  AdminResellerTeamMemberRow,
  CreateResellerData,
  ResellerCounts,
  ResellerDeleteResult,
  ResellerPatch,
  ResellerRecord,
  ResellerSuspendResult,
  ResellerSystemRoleIds,
  ResellerTierChangeResult,
  ResellerTierChangeRules,
  ResellerUnsuspendResult,
  ResellerUpdateResult,
} from './types';

/**
 * Platform-scope reseller management; every query runs as `roviq_admin`. The lifecycle
 * methods run one transaction each: read the reseller, call the service's rule (which throws
 * to refuse and roll back), then write.
 */
export abstract class AdminResellerRepository {
  /** Newest first, trashed included, with the count of every row the filters match. */
  abstract list(
    query: AdminResellerListQuery,
  ): Promise<{ records: ResellerRecord[]; totalCount: number }>;
  /** Trashed included. */
  abstract findById(resellerId: string): Promise<ResellerRecord | null>;
  /** Null when no reseller (trashed included) has this id. Newest member first. */
  abstract listTeam(resellerId: string): Promise<AdminResellerTeamMemberRow[] | null>;
  /** Slugs stay taken after deletion. */
  abstract slugTaken(slug: string): Promise<boolean>;
  /** Inserts an active reseller and its own copy of the system roles. */
  abstract create(
    data: CreateResellerData,
  ): Promise<{ reseller: ResellerRecord; roleIds: ResellerSystemRoleIds }>;
  /** Writes the patch under optimistic concurrency on `version`. */
  abstract update(
    resellerId: string,
    version: number,
    actorId: string,
    buildPatch: (existing: ResellerRecord) => ResellerPatch,
  ): Promise<ResellerUpdateResult>;
  /** Sets the tier, provisions the system roles and moves the memberships `planMoves` names. */
  abstract changeTier(
    resellerId: string,
    newTier: ResellerTier,
    actorId: string,
    rules: ResellerTierChangeRules,
  ): Promise<ResellerTierChangeResult>;
  /**
   * Suspends; the `resellers_revoke_sessions` trigger ends the staff's sessions in the same
   * UPDATE. Returns the staff and the impersonation sessions that UPDATE ended.
   */
  abstract suspend(
    resellerId: string,
    actorId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerSuspendResult>;
  abstract unsuspend(
    resellerId: string,
    actorId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerUnsuspendResult>;
  /**
   * Moves the institutes to `defaultResellerId`, soft-deletes the memberships and reseller
   * roles, and marks the reseller deleted.
   */
  abstract delete(
    resellerId: string,
    actorId: string,
    defaultResellerId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerDeleteResult>;
  /** Live institutes and active team members per reseller; ids with none are absent. */
  abstract counts(resellerIds: string[]): Promise<ResellerCounts>;
}
