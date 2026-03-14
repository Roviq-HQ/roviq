import type { CreateRefreshTokenData, RefreshTokenWithRelations } from './types';

export abstract class RefreshTokenRepository {
  abstract create(data: CreateRefreshTokenData): Promise<void>;
  abstract findByIdWithRelations(id: string): Promise<RefreshTokenWithRelations | null>;
  abstract revoke(id: string): Promise<void>;
  abstract revokeAllForUser(userId: string): Promise<void>;
}
