import type { FormHelpMode } from '@roviq/common-types';
import type { UserRecord } from './types';

export abstract class UserRepository {
  abstract getPreferredLocale(userId: string): Promise<string | null>;
  abstract updatePreferredLocale(userId: string, locale: string | null): Promise<void>;
  /** Null when the account does not exist or is deleted. */
  abstract getFormHelpMode(userId: string): Promise<FormHelpMode | null>;
  abstract updateFormHelpMode(userId: string, mode: FormHelpMode): Promise<void>;
  abstract findById(id: string): Promise<UserRecord | null>;
  abstract findByUsername(username: string): Promise<UserRecord | null>;
  abstract updatePasswordHash(id: string, passwordHash: string, changedAt: Date): Promise<void>;
  /**
   * ROV-96 — Set a brand-new password and clear the first-login flag in one statement.
   * Updates `password_hash`, sets `password_changed_at = now()`, and resets
   * `must_change_password = false`. Used by the changePassword mutation.
   * Also raises `token_version`, which ends every access token issued before, and returns it.
   */
  abstract updatePassword(userId: string, passwordHash: string): Promise<number>;
  abstract markEmailVerified(userId: string): Promise<void>;
}
