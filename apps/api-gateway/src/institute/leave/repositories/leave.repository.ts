import type { AppAbility, AppAction, LeaveStatus } from '@roviq/common-types';
import type {
  CreateLeaveData,
  LeaveListQuery,
  LeaveOnDateQuery,
  LeaveRecord,
  UpdateLeaveData,
} from './types';

export abstract class LeaveRepository {
  /** The leave, when the ability's read rules cover it. */
  abstract findById(id: string, ability: AppAbility): Promise<LeaveRecord | null>;
  /** Only the leaves the ability's read rules cover. */
  abstract list(query: LeaveListQuery, ability: AppAbility): Promise<LeaveRecord[]>;
  /** Whether the ability's rules for `action` cover this leave. */
  abstract isAllowed(id: string, ability: AppAbility, action: AppAction): Promise<boolean>;
  /** Whether the ability may file a leave for this membership of the caller's institute. */
  abstract canApplyFor(membershipId: string, ability: AppAbility): Promise<boolean>;
  abstract create(data: CreateLeaveData): Promise<LeaveRecord>;
  abstract update(id: string, data: UpdateLeaveData): Promise<LeaveRecord>;
  abstract setStatus(
    id: string,
    from: LeaveStatus,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    decidedBy: string,
  ): Promise<LeaveRecord>;
  abstract softDelete(id: string): Promise<void>;

  /**
   * Returns the membership ids (subset of `userIds`) that have an APPROVED
   * leave whose inclusive range contains `date`. Used by attendance to seed
   * LEAVE entries on session open.
   */
  abstract approvedOnDate(query: LeaveOnDateQuery): Promise<string[]>;
}
