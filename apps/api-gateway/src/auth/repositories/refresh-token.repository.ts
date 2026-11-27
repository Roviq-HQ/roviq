import type { RefreshTokenRevokeReason, SignedInUser } from '@roviq/common-types';
import type { CreateRefreshTokenData, OwnSessionRecord, RefreshTokenWithRelations } from './types';

/**
 * Only `ROTATION` (or a missing reason) fires the reuse cascade in `AuthService.refresh`;
 * a token revoked for any other reason was ended on purpose, and cascading would end the
 * caller's own keep-alive session.
 */
export type { RefreshTokenRevokeReason } from '@roviq/common-types';

export abstract class RefreshTokenRepository {
  abstract create(data: CreateRefreshTokenData): Promise<void>;
  abstract findByIdWithRelations(id: string): Promise<RefreshTokenWithRelations | null>;
  abstract findByHash(tokenHash: string): Promise<{ id: string; userId: string } | null>;
  /** The signed-in person's live sessions, read as that person. */
  abstract findOwnActive(user: SignedInUser): Promise<OwnSessionRecord[]>;
  /** Revokes one of the signed-in person's sessions; false when the id is not theirs. */
  abstract revokeOwn(
    user: SignedInUser,
    id: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<boolean>;
  abstract revoke(id: string, reason: RefreshTokenRevokeReason): Promise<void>;
  /** Token flow only (a reused token), where no one is signed in. */
  abstract revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason): Promise<void>;
  abstract revokeAllOwn(user: SignedInUser, reason: RefreshTokenRevokeReason): Promise<void>;
  abstract revokeAllOtherForUser(
    user: SignedInUser,
    currentTokenId: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<void>;
}
