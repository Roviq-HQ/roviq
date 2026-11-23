import type { GuardianRelationship } from '@roviq/common-types';
import type {
  guardianProfiles,
  guardianProfilesLive,
  studentGuardianLinks,
  studentGuardianLinksLive,
  tenantUserProfilesLive,
} from '@roviq/database';
import type { TenantUserProfileFields } from '../../../auth/tenant-user-profile';
import type { SignInState } from '../../sign-in-details/sign-in-status';

type GuardianLive = typeof guardianProfilesLive.$inferSelect;
type InstituteProfile = typeof tenantUserProfilesLive.$inferSelect;
type LinkLive = typeof studentGuardianLinksLive.$inferSelect;

/** A guardian joined with the institute's copy of their details. */
export type GuardianRecord = Pick<
  GuardianLive,
  | 'id'
  | 'userId'
  | 'membershipId'
  | 'occupation'
  | 'organization'
  | 'designation'
  | 'educationLevel'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
> &
  Pick<InstituteProfile, 'firstName' | 'lastName' | 'profileImageFileId' | 'gender'> & {
    primaryPhone: string | null;
    linkedStudentCount: number;
  };

export type GuardianWithSignIn = GuardianRecord & SignInState;

export type GuardianProfileRow = typeof guardianProfiles.$inferSelect;
export type StudentGuardianLinkRow = typeof studentGuardianLinks.$inferSelect;

export interface CreateGuardianMembershipData {
  tenantId: string;
  userId: string;
  roleId: string;
  actorId: string;
  profile: TenantUserProfileFields;
}

export interface CreateGuardianProfileData {
  tenantId: string;
  userId: string;
  membershipId: string;
  occupation: string | null;
  organization: string | null;
  educationLevel: GuardianProfileRow['educationLevel'];
  actorId: string;
}

/** Changed guardian fields only; an absent key keeps the stored value. */
export type GuardianProfilePatch = Partial<
  Pick<
    typeof guardianProfiles.$inferInsert,
    'occupation' | 'organization' | 'designation' | 'educationLevel'
  >
>;

export type UpdateGuardianResult =
  | { kind: 'not_found' }
  | { kind: 'version_mismatch' }
  | { kind: 'ok'; userId: string };

export interface DeletedGuardianRecord {
  id: string;
  firstName: InstituteProfile['firstName'];
  lastName: InstituteProfile['lastName'];
  deletedAt: Date;
}

export interface CreateGuardianLinkData {
  tenantId: string;
  actorId: string;
  studentProfileId: string;
  guardianProfileId: string;
  relationship: GuardianRelationship;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  canPickup: boolean;
  livesWith: boolean;
}

export type CreateGuardianLinkResult =
  | { kind: 'already_linked' }
  | { kind: 'ok'; link: StudentGuardianLinkRow };

/** A live link of the student, locked for the unlink. */
export interface LockedGuardianLink {
  id: string;
  guardianProfileId: string;
  isPrimaryContact: boolean;
}

/** What an unlink does, decided from the locked links. */
export interface UnlinkPlan {
  linkId: string;
  /** Link promoted to primary contact; null when none is. */
  replacementLinkId: string | null;
}

export interface LinkedStudentRecord {
  linkId: LinkLive['id'];
  studentProfileId: LinkLive['studentProfileId'];
  relationship: LinkLive['relationship'];
  isPrimaryContact: LinkLive['isPrimaryContact'];
  canPickup: LinkLive['canPickup'];
}
