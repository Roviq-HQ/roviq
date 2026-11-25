import type { RefreshTokenRevokeReason } from '@roviq/common-types';
import type { CreateRefreshTokenData, RefreshTokenWithRelations } from './types';

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
  abstract findActiveByUserId(userId: string): Promise<RefreshTokenWithRelations[]>;
  abstract revoke(id: string, reason: RefreshTokenRevokeReason): Promise<void>;
  abstract revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason): Promise<void>;
  abstract revokeAllOtherForUser(
    userId: string,
    currentTokenId: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<void>;
}
