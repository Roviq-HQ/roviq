import type { SignedInUser } from '@roviq/common-types';
import type { AuthProviderRecord, CreatePasskeyData } from './types';

export abstract class AuthProviderRepository {
  /**
   * Returns passkeys for a user, ordered by createdAt DESC (newest first).
   */
  // Methods that take the signed-in user run as that person and reach only their passkeys.
  abstract findPasskeysByUserId(user: SignedInUser): Promise<AuthProviderRecord[]>;
  abstract findByActiveUsername(username: string): Promise<AuthProviderRecord[]>;
  abstract findByCredentialId(credentialId: string): Promise<AuthProviderRecord | null>;
  abstract create(user: SignedInUser, data: CreatePasskeyData): Promise<AuthProviderRecord>;
  abstract updateProviderData(id: string, data: unknown): Promise<void>;
  abstract countOtherPasskeys(user: SignedInUser, excludeId: string): Promise<number>;
  abstract deletePasskey(user: SignedInUser, id: string): Promise<number>;
}
