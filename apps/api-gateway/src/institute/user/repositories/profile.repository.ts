import type { SignedInUser } from '@roviq/common-types';
import type {
  GuardianChildRecord,
  GuardianProfileRow,
  OwnProfileUpdate,
  ProfileMembershipRecord,
  StaffProfileRow,
  StudentAcademicRow,
  StudentProfileRow,
  TenantUserProfileRow,
  UpdatedUserProfileRow,
  UserProfileRow,
} from './types';

export abstract class ProfileRepository {
  abstract findMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<ProfileMembershipRecord | null>;
  abstract findRoleName(tenantId: string, roleId: string): Promise<Record<string, string> | null>;
  /** The account profile; keyed by the token user only. */
  /** The signed-in person's own account profile, read as that person. */
  abstract findUserProfile(user: SignedInUser): Promise<UserProfileRow | null>;
  /** The institute's own copy of the person's details. */
  abstract findInstituteProfile(
    tenantId: string,
    userId: string,
  ): Promise<TenantUserProfileRow | null>;
  abstract findStudentProfile(tenantId: string, userId: string): Promise<StudentProfileRow | null>;
  abstract findStudentAcademics(
    tenantId: string,
    studentProfileId: string,
  ): Promise<StudentAcademicRow | null>;
  abstract findStaffProfile(tenantId: string, userId: string): Promise<StaffProfileRow | null>;
  abstract findGuardianProfile(
    tenantId: string,
    userId: string,
  ): Promise<GuardianProfileRow | null>;
  /** The guardian's linked children, named as this institute records them. */
  abstract listGuardianChildren(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<GuardianChildRecord[]>;
  /** Null when the user has no account profile. Keyed by the token user only. */
  abstract updateOwnProfile(
    user: SignedInUser,
    fields: OwnProfileUpdate,
  ): Promise<UpdatedUserProfileRow | null>;
  /** Replaces the primary phone number, or adds one. Keyed by the token user only. */
  abstract setPrimaryPhone(user: SignedInUser, phone: string): Promise<void>;
}
