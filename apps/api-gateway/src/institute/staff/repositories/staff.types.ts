import type { EmploymentType } from '@roviq/common-types';
import type { staffProfiles, staffProfilesLive, tenantUserProfilesLive } from '@roviq/database';
import type { TenantUserProfileFields } from '../../../auth/tenant-user-profile';
import type { SignInState } from '../../sign-in-details/sign-in-status';

type StaffLive = typeof staffProfilesLive.$inferSelect;
type InstituteProfile = typeof tenantUserProfilesLive.$inferSelect;

/** A staff member joined with the institute's copy of their details. */
export type StaffRecord = Pick<
  StaffLive,
  | 'id'
  | 'userId'
  | 'membershipId'
  | 'employeeId'
  | 'designation'
  | 'department'
  | 'dateOfJoining'
  | 'dateOfLeaving'
  | 'employmentType'
  | 'isClassTeacher'
  | 'socialCategory'
  | 'specialization'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
> &
  Pick<
    InstituteProfile,
    'firstName' | 'lastName' | 'gender' | 'dateOfBirth' | 'profileImageFileId'
  >;

export type StaffWithSignIn = StaffRecord & SignInState;

export type StaffProfileRow = typeof staffProfiles.$inferSelect;

export interface StaffListQuery {
  department?: string;
  designation?: string;
  employmentType?: EmploymentType;
  isClassTeacher?: boolean;
  search?: string;
  limit: number;
}

export interface CreateStaffMembershipData {
  tenantId: string;
  userId: string;
  roleId: string;
  actorId: string;
  profile: TenantUserProfileFields;
}

export interface CreateStaffProfileData {
  tenantId: string;
  userId: string;
  membershipId: string;
  employeeId: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: string;
  employmentType: EmploymentType;
  specialization: string | null;
  actorId: string;
}

/** Changed staff fields only; an absent key keeps the stored value. */
export type StaffProfilePatch = Partial<
  Pick<
    typeof staffProfiles.$inferInsert,
    | 'designation'
    | 'department'
    | 'employmentType'
    | 'isClassTeacher'
    | 'specialization'
    | 'socialCategory'
  >
>;

export interface UpdateStaffData {
  tenantId: string;
  id: string;
  actorId: string;
  version: number;
  staff: StaffProfilePatch;
  profile: Partial<TenantUserProfileFields>;
}

export type UpdateStaffResult =
  | { kind: 'not_found' }
  | { kind: 'version_mismatch' }
  | { kind: 'ok'; row: StaffProfileRow };

export interface DeletedStaffRecord {
  id: string;
  firstName: InstituteProfile['firstName'];
  lastName: InstituteProfile['lastName'];
  identifier: string | null;
  deletedAt: Date;
}

export interface StaffStatistics {
  total: number;
  active: number;
  classTeachers: number;
  byDepartment: { department: string; count: number }[];
}
