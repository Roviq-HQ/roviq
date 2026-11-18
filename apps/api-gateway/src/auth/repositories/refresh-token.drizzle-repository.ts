import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  refreshTokens,
  refreshTokensLive,
  rolesLive,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { RefreshTokenRepository, type RefreshTokenRevokeReason } from './refresh-token.repository';
import type { CreateRefreshTokenData, RefreshTokenWithRelations } from './types';

/**
 * Canonical set of revoke reasons. Used by {@link coerceRevokedReason} to
 * narrow the raw `varchar` coming out of Postgres (`string | null`) into the
 * domain-level {@link RefreshTokenRevokeReason} union the rest of the code
 * expects. Single source of truth — keep in sync with the union above.
 */
const VALID_REVOKE_REASONS: ReadonlySet<RefreshTokenRevokeReason> = new Set([
  'rotation',
  'user_initiated',
  'password_change',
  'admin_revoked',
]);

/**
 * Validate and narrow a raw DB value into `RefreshTokenRevokeReason | null`.
 *
 * The single `as RefreshTokenRevokeReason` below is the ONE cast justified
 * in this file: it's gated by a runtime `Set.has` check against the canonical
 * reason list, so the cast only fires on values we've just proven to be
 * members of the union.
 *
 * Unknown non-null values collapse to `null` on purpose — the refresh flow's
 * cascade gate already treats `null` as "legacy/unknown ⇒ rotate-as-cascade",
 * which is the safest default for data we can't classify.
 */
function coerceRevokedReason(raw: string | null): RefreshTokenRevokeReason | null {
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
            id: usersLive.id,
            username: usersLive.username,
            email: usersLive.email,
            status: usersLive.status,
            passwordChangedAt: usersLive.passwordChangedAt,
            mustChangePassword: usersLive.mustChangePassword,
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
          instituteLogoUrl: institutesLive.logoUrl,
          instituteResellerId: institutesLive.resellerId,
        })
        .from(refreshTokensLive)
        .innerJoin(usersLive, eq(refreshTokensLive.userId, usersLive.id))
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
                  logoUrl: row.instituteLogoUrl,
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

  async findActiveByUserId(userId: string): Promise<RefreshTokenWithRelations[]> {
    return withAdmin(this.db, mkAdminCtx('repository:refresh-token'), async (tx) => {
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
            id: usersLive.id,
            username: usersLive.username,
            email: usersLive.email,
            status: usersLive.status,
            passwordChangedAt: usersLive.passwordChangedAt,
            mustChangePassword: usersLive.mustChangePassword,
          },
          membershipId: membershipsLive.id,
          membershipTenantId: membershipsLive.tenantId,
          membershipRoleId: membershipsLive.roleId,
          membershipAbilities: membershipsLive.abilities,
          roleId: rolesLive.id,
          roleAbilities: rolesLive.abilities,
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          instituteSlug: institutesLive.slug,
          instituteLogoUrl: institutesLive.logoUrl,
          instituteResellerId: institutesLive.resellerId,
        })
        .from(refreshTokensLive)
        .innerJoin(usersLive, eq(refreshTokensLive.userId, usersLive.id))
        .leftJoin(membershipsLive, eq(refreshTokensLive.membershipId, membershipsLive.id))
        .leftJoin(rolesLive, eq(membershipsLive.roleId, rolesLive.id))
        .leftJoin(institutesLive, eq(membershipsLive.tenantId, institutesLive.id))
        .where(
          and(
            eq(refreshTokensLive.userId, userId),
            isNull(refreshTokensLive.revokedAt),
            gt(refreshTokensLive.expiresAt, new Date()),
          ),
        );

      return rows.map((row) => ({
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
                  logoUrl: row.instituteLogoUrl,
                  resellerId: row.instituteResellerId,
                },
              }
            : null,
      }));
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

  async revokeAllOtherForUser(
    userId: string,
    currentTokenId: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:refresh-token'), (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            ne(refreshTokens.id, currentTokenId),
          ),
        ),
    );
  }
}
