import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  refreshTokens,
  roles,
  users,
  withAdmin,
} from '@roviq/database';
import { and, eq, isNull } from 'drizzle-orm';
import { RefreshTokenRepository } from './refresh-token.repository';
import type { CreateRefreshTokenData, RefreshTokenWithRelations } from './types';

@Injectable()
export class RefreshTokenDrizzleRepository extends RefreshTokenRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async create(data: CreateRefreshTokenData): Promise<void> {
    await withAdmin(this.db, (tx) =>
      tx.insert(refreshTokens).values({
        id: data.id,
        tokenHash: data.tokenHash,
        userId: data.userId,
        tenantId: data.tenantId,
        membershipId: data.membershipId ?? null,
        expiresAt: data.expiresAt,
      }),
    );
  }

  async findByIdWithRelations(id: string): Promise<RefreshTokenWithRelations | null> {
    return withAdmin(this.db, async (tx) => {
      // Single query: token + user + optional membership + role
      const rows = await tx
        .select({
          id: refreshTokens.id,
          tokenHash: refreshTokens.tokenHash,
          userId: refreshTokens.userId,
          revokedAt: refreshTokens.revokedAt,
          expiresAt: refreshTokens.expiresAt,
          user: {
            id: users.id,
            username: users.username,
            email: users.email,
            passwordHash: users.passwordHash,
            status: users.status,
            isPlatformAdmin: users.isPlatformAdmin,
          },
          membershipId: memberships.id,
          membershipTenantId: memberships.tenantId,
          membershipRoleId: memberships.roleId,
          membershipAbilities: memberships.abilities,
          roleId: roles.id,
          roleAbilities: roles.abilities,
        })
        .from(refreshTokens)
        .innerJoin(users, eq(refreshTokens.userId, users.id))
        .leftJoin(memberships, eq(refreshTokens.membershipId, memberships.id))
        .leftJoin(roles, eq(memberships.roleId, roles.id))
        .where(eq(refreshTokens.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        tokenHash: row.tokenHash,
        userId: row.userId,
        revokedAt: row.revokedAt,
        expiresAt: row.expiresAt,
        user: row.user,
        membership:
          row.membershipId && row.membershipTenantId && row.membershipRoleId && row.roleId
            ? {
                id: row.membershipId,
                tenantId: row.membershipTenantId,
                roleId: row.membershipRoleId,
                abilities: row.membershipAbilities,
                role: {
                  id: row.roleId,
                  abilities: row.roleAbilities,
                },
              }
            : null,
      };
    });
  }

  async revoke(id: string): Promise<void> {
    await withAdmin(this.db, (tx) =>
      tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id)),
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await withAdmin(this.db, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))),
    );
  }
}
