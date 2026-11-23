import type {
  guardianProfilesLive,
  staffProfilesLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  userProfiles,
  userProfilesLive,
} from '@roviq/database';

export interface ProfileMembershipRecord {
  roleId: string;
  userId: string;
}

export type UserProfileRow = typeof userProfilesLive.$inferSelect;
export type UpdatedUserProfileRow = typeof userProfiles.$inferSelect;
export type TenantUserProfileRow = typeof tenantUserProfilesLive.$inferSelect;
export type StudentProfileRow = typeof studentProfilesLive.$inferSelect;
export type StudentAcademicRow = typeof studentAcademicsLive.$inferSelect;
export type StaffProfileRow = typeof staffProfilesLive.$inferSelect;
export type GuardianProfileRow = typeof guardianProfilesLive.$inferSelect;

type LinkRow = typeof studentGuardianLinksLive.$inferSelect;

export interface GuardianChildRecord {
  studentProfileId: LinkRow['studentProfileId'];
  relationship: LinkRow['relationship'];
  isPrimaryContact: LinkRow['isPrimaryContact'];
  firstName: TenantUserProfileRow['firstName'];
  lastName: TenantUserProfileRow['lastName'];
}

/** Self-service fields of the account profile; an absent key is left as it is. */
export interface OwnProfileUpdate {
  nationality?: string;
  religion?: string;
  motherTongue?: string;
}
