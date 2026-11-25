import type { SignInTarget } from '../../sign-in-details/sign-in-details.service';
import type {
  CreateStaffData,
  CreateStaffResult,
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
  /**
   * Membership, the institute's copy of the person's details and the staff profile, in one
   * transaction: nothing is written unless all of it is. A null employee ID takes the next free
   * value of the series; `employee_id_taken` only for a typed ID.
   */
  abstract create(data: CreateStaffData): Promise<CreateStaffResult>;
  /** Whether a current staff member of the institute holds this employee ID. */
  abstract isEmployeeIdTaken(tenantId: string, employeeId: string): Promise<boolean>;
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
