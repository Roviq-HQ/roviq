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

/** What the profile page shows of the account profile. */
export const OWN_PROFILE_COLUMNS = [
  'id',
  'userId',
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'bloodGroup',
  'nationality',
  'profileImageFileId',
] as const;

/** What the profile page shows of the institute's own record of the person. */
export const INSTITUTE_PROFILE_COLUMNS = [
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'bloodGroup',
  'nationality',
] as const;

export type UserProfileRow = Pick<
  typeof userProfilesLive.$inferSelect,
  (typeof OWN_PROFILE_COLUMNS)[number]
>;
export type UpdatedUserProfileRow = Pick<
  typeof userProfiles.$inferSelect,
  (typeof OWN_PROFILE_COLUMNS)[number]
>;
export type TenantUserProfileRow = Pick<
  typeof tenantUserProfilesLive.$inferSelect,
  (typeof INSTITUTE_PROFILE_COLUMNS)[number]
>;
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
