import type { FormHelpMode, SignedInUser } from '@roviq/common-types';
import type { OwnAccountName, UserRecord } from './types';

export abstract class UserRepository {
  // Methods that take the signed-in user run as that person: the database gives them the
  // account row of the token's user and no other.
  abstract getPreferredLocale(user: SignedInUser): Promise<string | null>;
  abstract updatePreferredLocale(user: SignedInUser, locale: string | null): Promise<void>;
  /** Null when the account does not exist or is deleted. */
  abstract getFormHelpMode(user: SignedInUser): Promise<FormHelpMode | null>;
  abstract updateFormHelpMode(user: SignedInUser, mode: FormHelpMode): Promise<void>;
  /** The signed-in person's own account; null when it was deleted mid-session. */
  abstract findOwn(user: SignedInUser): Promise<UserRecord | null>;
  /** Sign-in name and email of the account, for the app shell; also read in an impersonation session. */
  abstract findOwnName(user: SignedInUser): Promise<OwnAccountName | null>;
  /** Sign-in and token flows only, where no one is signed in yet. */
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findByUsername(username: string): Promise<UserRecord | null>;
  abstract updatePasswordHash(id: string, passwordHash: string, changedAt: Date): Promise<void>;
  /**
   * ROV-96 — Set a brand-new password and clear the first-login flag in one statement.
   * Updates `password_hash`, sets `password_changed_at = now()`, and resets
   * `must_change_password = false`. Used by the changePassword mutation.
   * Also raises `token_version`, which ends every access token issued before, and returns it.
   */
  abstract updatePassword(user: SignedInUser, passwordHash: string): Promise<number>;
  abstract markEmailVerified(user: SignedInUser): Promise<void>;
}
