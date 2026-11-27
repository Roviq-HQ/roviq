import { Inject, Injectable } from '@nestjs/common';
import { REFRESH_TOKEN_REVOKE_REASON_VALUES, type SignedInUser } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  refreshTokens,
  refreshTokensLive,
  rolesLive,
  users,
  withAdmin,
  withUser,
} from '@roviq/database';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { RefreshTokenRepository, type RefreshTokenRevokeReason } from './refresh-token.repository';
import type { CreateRefreshTokenData, OwnSessionRecord, RefreshTokenWithRelations } from './types';

const VALID_REVOKE_REASONS: ReadonlySet<RefreshTokenRevokeReason> = new Set(
  REFRESH_TOKEN_REVOKE_REASON_VALUES,
);

/**
 * An unknown stored reason reads as `null`, which the refresh flow treats like `ROTATION`
 * (cascade): a reason we cannot classify is not proof the revocation was deliberate.
 */
export function coerceRevokedReason(raw: string | null): RefreshTokenRevokeReason | null {
  if (raw === null) return null;
  return (VALID_REVOKE_REASONS as ReadonlySet<string>).has(raw)
    ? (raw as RefreshTokenRevokeReason)
    : null;
}

@Injectable()
export class RefreshTokenDrizzleRepository extends RefreshTokenRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async create(data: CreateRefreshTokenData): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:refresh-token'), (tx) =>
      tx.insert(refreshTokens).values({
        createdBy: data.userId,
        updatedBy: data.userId,
        id: data.id,
        tokenHash: data.tokenHash,
        userId: data.userId,
        tenantId: data.tenantId,
        membershipId: data.membershipId,
        membershipScope: data.membershipScope,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        deviceInfo: data.deviceInfo ?? null,
      }),
    );
  }

  async findByIdWithRelations(id: string): Promise<RefreshTokenWithRelations | null> {
    return withAdmin(this.db, mkAdminCtx('repository:refresh-token'), async (tx) => {
      // Single query: token + user + optional membership + role
      const rows = await tx
        .select({
          id: refreshTokensLive.id,
          tokenHash: refreshTokensLive.tokenHash,
          userId: refreshTokensLive.userId,
          membershipScope: refreshTokensLive.membershipScope,
          revokedAt: refreshTokensLive.revokedAt,
          revokedReason: refreshTokensLive.revokedReason,
          expiresAt: refreshTokensLive.expiresAt,
          createdAt: refreshTokensLive.createdAt,
          deviceInfo: refreshTokensLive.deviceInfo,
          ipAddress: refreshTokensLive.ipAddress,
          userAgent: refreshTokensLive.userAgent,
          lastUsedAt: refreshTokensLive.lastUsedAt,
          user: {
            id: users.id,
            username: users.username,
            email: users.email,
            status: users.status,
            passwordChangedAt: users.passwordChangedAt,
            mustChangePassword: users.mustChangePassword,
            emailVerifiedAt: users.emailVerifiedAt,
            tokenVersion: users.tokenVersion,
          },
          membershipId: membershipsLive.id,
          membershipTenantId: membershipsLive.tenantId,
          membershipRoleId: membershipsLive.roleId,
          membershipAbilities: membershipsLive.abilities,
          roleId: rolesLive.id,
          roleAbilities: rolesLive.abilities,
          // Institute fields — required so the refresh flow can mint an
          // institute-scope JWT containing `resellerId` (ROV-261) without
          // an extra round-trip to membershipRepo.findByIdAndUser.
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          instituteSlug: institutesLive.slug,
          instituteResellerId: institutesLive.resellerId,
        })
        .from(refreshTokensLive)
        .innerJoin(users, and(eq(refreshTokensLive.userId, users.id), isNull(users.deletedAt))) // allow-base-read: password_hash and token_version are not on users_live (ROV-279)
        .leftJoin(membershipsLive, eq(refreshTokensLive.membershipId, membershipsLive.id))
        .leftJoin(rolesLive, eq(membershipsLive.roleId, rolesLive.id))
        .leftJoin(institutesLive, eq(membershipsLive.tenantId, institutesLive.id))
        .where(eq(refreshTokensLive.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        tokenHash: row.tokenHash,
        userId: row.userId,
        membershipScope: row.membershipScope,
        revokedAt: row.revokedAt,
        revokedReason: coerceRevokedReason(row.revokedReason),
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        deviceInfo: row.deviceInfo,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        lastUsedAt: row.lastUsedAt,
        user: row.user,
        membership:
          // The guards on every institute field are TS-driven, not just
          // defensive: drizzle's LEFT JOIN inference marks all joined columns
          // as nullable even though name/slug/reseller_id are NOT NULL in the
          // schema. The runtime checks are what narrow the type so the
          // `institute: { ... }` literal below satisfies `InstituteInfo`.
          row.membershipId &&
          row.membershipTenantId &&
          row.membershipRoleId &&
          row.roleId &&
          row.instituteId &&
          row.instituteName &&
          row.instituteSlug !== null &&
          row.instituteResellerId
            ? {
                id: row.membershipId,
                tenantId: row.membershipTenantId,
                roleId: row.membershipRoleId,
                abilities: row.membershipAbilities,
                role: {
                  id: row.roleId,
                  abilities: row.roleAbilities,
                },
                institute: {
                  id: row.instituteId,
                  name: row.instituteName,
                  slug: row.instituteSlug,
                  resellerId: row.instituteResellerId,
                },
              }
            : null,
      };
    });
  }

  async findByHash(tokenHash: string): Promise<{ id: string; userId: string } | null> {
    return withAdmin(this.db, mkAdminCtx('repository:refresh-token'), async (tx) => {
      const rows = await tx
        .select({ id: refreshTokensLive.id, userId: refreshTokensLive.userId })
        .from(refreshTokensLive)
        .where(and(eq(refreshTokensLive.tokenHash, tokenHash), isNull(refreshTokensLive.revokedAt)))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async findOwnActive(user: SignedInUser): Promise<OwnSessionRecord[]> {
    return withUser(this.db, user, (tx) =>
      tx
        .select({
          id: refreshTokensLive.id,
          tokenHash: refreshTokensLive.tokenHash,
          expiresAt: refreshTokensLive.expiresAt,
          createdAt: refreshTokensLive.createdAt,
          deviceInfo: refreshTokensLive.deviceInfo,
          ipAddress: refreshTokensLive.ipAddress,
          userAgent: refreshTokensLive.userAgent,
          lastUsedAt: refreshTokensLive.lastUsedAt,
        })
        .from(refreshTokensLive)
        .where(
          and(
            eq(refreshTokensLive.userId, user.userId),
            isNull(refreshTokensLive.revokedAt),
            gt(refreshTokensLive.expiresAt, new Date()),
          ),
        ),
    );
  }

  async revokeOwn(
    user: SignedInUser,
    id: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<boolean> {
    return withUser(this.db, user, async (tx) => {
      const [session] = await tx
        .select({ id: refreshTokensLive.id })
        .from(refreshTokensLive)
        .where(and(eq(refreshTokensLive.id, id), eq(refreshTokensLive.userId, user.userId)))
        .limit(1);
      if (!session) return false;
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
      return true;
    });
  }

  async revoke(id: string, reason: RefreshTokenRevokeReason): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:refresh-token'), (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt))),
    );
  }

  async revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:refresh-token'), (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))),
    );
  }

  async revokeAllOwn(user: SignedInUser, reason: RefreshTokenRevokeReason): Promise<void> {
    await withUser(this.db, user, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(refreshTokens.userId, user.userId), isNull(refreshTokens.revokedAt))),
    );
  }

  async revokeAllOtherForUser(
    user: SignedInUser,
    currentTokenId: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<void> {
    await withUser(this.db, user, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(
          and(
            eq(refreshTokens.userId, user.userId),
            isNull(refreshTokens.revokedAt),
            ne(refreshTokens.id, currentTokenId),
          ),
        ),
    );
  }
}
