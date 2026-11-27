import type { TenantUserProfileFields } from '../../../auth/tenant-user-profile';
import type { SignInTarget } from '../../sign-in-details/sign-in-details.service';
import type {
  CreateGuardianLinkData,
  CreateGuardianLinkResult,
  CreateGuardianMembershipData,
  CreateGuardianProfileData,
  DeletedGuardianRecord,
  GuardianProfilePatch,
  GuardianProfileRow,
  GuardianWithSignIn,
  LinkedStudentRecord,
  LockedGuardianLink,
  StudentGuardianLinkRow,
  UnlinkPlan,
  UpdateGuardianResult,
} from './types';

export abstract class GuardianRepository {
  abstract findById(tenantId: string, id: string): Promise<GuardianWithSignIn | null>;
  /** The institute's Parent role, matched on its English name. */
  abstract findParentRoleId(tenantId: string): Promise<string | null>;
  /** Membership plus the institute's copy of the person's details, in one transaction. */
  abstract createMembership(data: CreateGuardianMembershipData): Promise<{ id: string }>;
  abstract createProfile(data: CreateGuardianProfileData): Promise<GuardianProfileRow>;
  /** Null when the guardian profile is not in this institute. */
  abstract findSignInTarget(tenantId: string, id: string): Promise<SignInTarget | null>;
  /** Existence check and versioned update, in one transaction. */
  abstract updateProfile(
    tenantId: string,
    id: string,
    actorId: string,
    version: number,
    patch: GuardianProfilePatch,
  ): Promise<UpdateGuardianResult>;
  abstract updateInstituteProfile(
    tenantId: string,
    userId: string,
    actorId: string,
    changes: Partial<TenantUserProfileFields>,
  ): Promise<void>;
  /** Students the guardian has a live link to. */
  abstract listLinkedStudentIds(tenantId: string, guardianProfileId: string): Promise<string[]>;
  /** Whether the student has a live link to a live guardian other than this one. */
  abstract hasOtherGuardian(
    tenantId: string,
    studentProfileId: string,
    guardianProfileId: string,
  ): Promise<boolean>;
  /** False when no live guardian matched. */
  abstract softDelete(tenantId: string, id: string, actorId: string): Promise<boolean>;
  abstract listDeleted(tenantId: string): Promise<DeletedGuardianRecord[]>;
  /** False when no deleted guardian matched. */
  abstract restore(tenantId: string, id: string, actorId: string): Promise<boolean>;
  abstract studentExists(tenantId: string, studentProfileId: string): Promise<boolean>;
  abstract guardianExists(tenantId: string, guardianProfileId: string): Promise<boolean>;
  abstract clearPrimaryContact(
    tenantId: string,
    studentProfileId: string,
    actorId: string,
  ): Promise<void>;
  abstract createLink(data: CreateGuardianLinkData): Promise<CreateGuardianLinkResult>;
  /**
   * Locks the student's live links, asks `plan` what to do (it throws to refuse), then
   * soft-deletes the link and promotes the replacement, in one transaction.
   */
  abstract unlink(
    tenantId: string,
    studentProfileId: string,
    actorId: string,
    plan: (links: LockedGuardianLink[]) => UnlinkPlan,
  ): Promise<void>;
  /**
   * Closes the guardian's access to the student and clears pickup and primary contact; the
   * link stays. Null when no link matched.
   */
  abstract revokeAccess(
    tenantId: string,
    studentProfileId: string,
    guardianProfileId: string,
    actorId: string,
  ): Promise<StudentGuardianLinkRow | null>;
  /** Opens the access again; pickup and primary contact stay as they are. Null when no link matched. */
  abstract restoreAccess(
    tenantId: string,
    studentProfileId: string,
    guardianProfileId: string,
    actorId: string,
  ): Promise<StudentGuardianLinkRow | null>;
  abstract listLinkedStudents(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<LinkedStudentRecord[]>;
}
