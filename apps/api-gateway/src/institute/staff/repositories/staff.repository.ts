import type { SignInTarget } from '../../sign-in-details/sign-in-details.service';
import type {
  CreateStaffMembershipData,
  CreateStaffProfileData,
  CreateStaffProfileResult,
  DeletedStaffRecord,
  RestoreStaffResult,
  StaffListQuery,
  StaffProfileRow,
  StaffStatistics,
  StaffWithSignIn,
  UpdateStaffData,
  UpdateStaffResult,
} from './staff.types';

export abstract class StaffRepository {
  abstract findById(tenantId: string, id: string): Promise<StaffWithSignIn | null>;
  abstract list(tenantId: string, query: StaffListQuery): Promise<StaffWithSignIn[]>;
  /** The institute's Teacher role, matched on its English name. */
  abstract findTeacherRoleId(tenantId: string): Promise<string | null>;
  /** Membership plus the institute's copy of the person's details, in one transaction. */
  abstract createMembership(data: CreateStaffMembershipData): Promise<{ id: string }>;
  /**
   * Next value of the institute's employee_id sequence (created on first use) that no current
   * staff member holds: a typed ID may already have taken a value of the series.
   */
  abstract nextEmployeeId(tenantId: string): Promise<string>;
  /** Whether a current staff member of the institute holds this employee ID. */
  abstract isEmployeeIdTaken(tenantId: string, employeeId: string): Promise<boolean>;
  abstract createProfile(data: CreateStaffProfileData): Promise<CreateStaffProfileResult>;
  /** Null when the staff profile is not in this institute. */
  abstract findSignInTarget(tenantId: string, id: string): Promise<SignInTarget | null>;
  /** Existence check, versioned update and institute profile change, in one transaction. */
  abstract update(data: UpdateStaffData): Promise<UpdateStaffResult>;
  /** Soft-deletes and stamps the leaving date; null when no live row matched. */
  abstract softDelete(
    tenantId: string,
    id: string,
    actorId: string,
    dateOfLeaving: string,
  ): Promise<StaffProfileRow | null>;
  abstract listDeleted(tenantId: string): Promise<DeletedStaffRecord[]>;
  /** `employee_id_taken` when a current staff member now holds the deleted row's employee ID. */
  abstract restore(tenantId: string, id: string, actorId: string): Promise<RestoreStaffResult>;
  abstract statistics(tenantId: string): Promise<StaffStatistics>;
}
