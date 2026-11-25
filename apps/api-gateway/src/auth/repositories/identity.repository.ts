import type {
  NewInstituteMembership,
  NewPlatformMembership,
  NewResellerMembership,
  NewUserProfile,
  NewUserRecord,
  UserContactRow,
  UserEmailMatch,
} from './types';

/** Queries behind IdentityService: users, memberships, profiles and phones. */
export abstract class IdentityRepository {
  /** Soft-deleted users included: the email stays globally unique after deletion. */
  abstract findUsersByEmail(email: string): Promise<UserEmailMatch[]>;
  /** Soft-deleted users included. */
  abstract usernameExists(username: string): Promise<boolean>;
  abstract verifiedPhoneExists(phone: { countryCode: string; number: string }): Promise<boolean>;
  /** Leaves an existing profile untouched. */
  abstract insertUserProfileIfMissing(profile: NewUserProfile): Promise<void>;
  /** User and primary phone read in one transaction; null when the user is gone. */
  abstract findUserContact(userId: string): Promise<UserContactRow | null>;
  /**
   * In one transaction: deletes the user, its phones and its account profile, but only when it
   * has never been used: no membership of any scope (deleted ones count; a session needs one)
   * and a password it never changed. Returns false and deletes nothing otherwise.
   */
  abstract deleteUnusedUser(userId: string): Promise<boolean>;
  abstract wasCreatedByReseller(userId: string, resellerId: string): Promise<boolean>;
  /**
   * In one transaction: replaces the hash only while `must_change_password` is still true and
   * the user is live, raising `token_version` in the same statement, then revokes every live
   * refresh token. Returns the new token version, or null when no row matched.
   */
  abstract replaceTempPassword(
    userId: string,
    passwordHash: string,
    actorId: string,
  ): Promise<number | null>;
  abstract findInstituteMembershipId(
    userId: string,
    tenantId: string,
    roleId: string,
  ): Promise<string | null>;
  /** The account and its primary phone, in one transaction. Returns the user id. */
  abstract insertUser(user: NewUserRecord): Promise<string>;
  /**
   * In one institute transaction: the membership, then the institute's own copy of the
   * account name when the account has a profile. Returns the membership id.
   */
  abstract insertInstituteMembership(membership: NewInstituteMembership): Promise<string>;
  abstract insertResellerMembership(membership: NewResellerMembership): Promise<string>;
  abstract insertPlatformMembership(membership: NewPlatformMembership): Promise<string>;
}
