import { Inject, Injectable } from '@nestjs/common';
import { DefaultRoles, type ResellerContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  type I18nContent,
  impersonationSessions,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  phoneNumbersLive,
  platformMembershipsLive,
  resellerMembershipsLive,
  rolesLive,
  userProfilesLive,
  usersLive,
  withAdmin,
  withReseller,
} from '@roviq/database';
import { and, asc, desc, eq, gt, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ImpersonationRepository } from './impersonation.repository';
import type {
  ExpiredImpersonationSession,
  ImpersonationActorMembership,
  ImpersonationExchangeRows,
  ImpersonationInstitute,
  ImpersonationSessionFilter,
  ImpersonationSessionForEnd,
  ImpersonationSessionList,
  ImpersonationTargetMembership,
  ImpersonatorRoleNames,
  NewImpersonationSession,
  RankedRole,
} from './types';

@Injectable()
export class ImpersonationDrizzleRepository extends ImpersonationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findUserStatus(userId: string): Promise<{ id: string; status: string } | null> {
    const targetUser = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: usersLive.id, status: usersLive.status })
        .from(usersLive)
        .where(eq(usersLive.id, userId))
        .limit(1),
    );
    return targetUser[0] ?? null;
  }

  async findActiveMembershipsWithRole(
    userId: string,
    tenantId: string,
  ): Promise<ImpersonationTargetMembership[]> {
    return withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          roleName: sql<string>`${rolesLive.name}->>'en'`,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.userId, userId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id)),
    );
  }

  async findInstitute(tenantId: string): Promise<ImpersonationInstitute | null> {
    const [targetInstitute] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: institutesLive.id,
          resellerId: institutesLive.resellerId,
          requireImpersonationConsent: institutesLive.requireImpersonationConsent,
        })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1),
    );
    return targetInstitute ?? null;
  }

  async isInstituteOfReseller(reseller: ResellerContext, tenantId: string): Promise<boolean> {
    const [institute] = await withReseller(this.db, reseller, (tx) =>
      tx
        .select({ id: institutesLive.id })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1),
    );
    return institute !== undefined;
  }

  async findExchangeRows(params: {
    sessionId: string;
    targetUserId: string;
    targetMembershipId: string;
    tenantId: string;
  }): Promise<ImpersonationExchangeRows> {
    const { sessionId, targetUserId, targetMembershipId, tenantId } = params;
    const [targetUsers, membershipRows, sessions, instituteRows] = await withAdmin(
      this.db,
      mkAdminCtx('service:impersonation'),
      (tx) =>
        Promise.all([
          tx
            .select({
              id: usersLive.id,
              username: usersLive.username,
              firstName: userProfilesLive.firstName,
              lastName: userProfilesLive.lastName,
            })
            .from(usersLive)
            .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
            .where(and(eq(usersLive.id, targetUserId), eq(usersLive.status, 'ACTIVE')))
            .limit(1),
          tx
            .select({
              id: membershipsLive.id,
              tenantId: membershipsLive.tenantId,
              roleId: membershipsLive.roleId,
            })
            .from(membershipsLive)
            .where(
              and(
                // Exactly the membership that was authorized at start.
                eq(membershipsLive.id, targetMembershipId),
                eq(membershipsLive.userId, targetUserId),
                eq(membershipsLive.tenantId, tenantId),
                eq(membershipsLive.status, 'ACTIVE'),
              ),
            )
            .limit(1),
          tx
            .select({
              id: impersonationSessions.id,
              impersonatorId: impersonationSessions.impersonatorId,
              impersonatorScope: impersonationSessions.impersonatorScope,
              endedAt: impersonationSessions.endedAt,
              expiresAt: impersonationSessions.expiresAt,
            })
            .from(impersonationSessions)
            .where(eq(impersonationSessions.id, sessionId))
            .limit(1),
          tx
            .select({
              id: institutesLive.id,
              name: institutesLive.name,
              resellerId: institutesLive.resellerId,
            })
            .from(institutesLive)
            .where(eq(institutesLive.id, tenantId))
            .limit(1),
        ]),
    );
    return {
      targetUser: targetUsers[0] ?? null,
      membership: membershipRows[0] ?? null,
      session: sessions[0] ?? null,
      institute: instituteRows[0] ?? null,
    };
  }

  async findSessionForEnd(sessionId: string): Promise<ImpersonationSessionForEnd | null> {
    const [session] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          targetUserId: impersonationSessions.targetUserId,
          targetTenantId: impersonationSessions.targetTenantId,
          endedAt: impersonationSessions.endedAt,
        })
        .from(impersonationSessions)
        .where(eq(impersonationSessions.id, sessionId))
        .limit(1),
    );
    return session ?? null;
  }

  async endSession(sessionId: string, endedAt: Date, endedReason: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .update(impersonationSessions)
        .set({
          endedAt,
          endedReason,
        })
        .where(and(eq(impersonationSessions.id, sessionId), isNull(impersonationSessions.endedAt))),
    );
  }

  async expireOverdueSessions(): Promise<ExpiredImpersonationSession[]> {
    return withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .update(impersonationSessions)
        .set({ endedAt: impersonationSessions.expiresAt, endedReason: 'expired' })
        .where(
          and(
            isNull(impersonationSessions.endedAt),
            lte(impersonationSessions.expiresAt, sql`now()`),
          ),
        )
        .returning({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          targetTenantId: impersonationSessions.targetTenantId,
        }),
    );
  }

  async listSessions(opts: ImpersonationSessionFilter): Promise<ImpersonationSessionList> {
    return withAdmin(this.db, mkAdminCtx('service:impersonation-list'), async (tx) => {
      const conditions: SQL[] = [];

      if (opts.resellerId) {
        const staff = await tx
          .select({ userId: resellerMembershipsLive.userId })
          .from(resellerMembershipsLive)
          .where(eq(resellerMembershipsLive.resellerId, opts.resellerId));
        const staffIds = staff.map((s) => s.userId);
        if (staffIds.length === 0) return { rows: [], roles: emptyRoleNames() };
        conditions.push(inArray(impersonationSessions.impersonatorId, staffIds));
      }
      if (opts.sessionId) conditions.push(eq(impersonationSessions.id, opts.sessionId));
      if (opts.activeOnly) {
        // Active means neither ended nor past its expiry, matching `status`.
        conditions.push(isNull(impersonationSessions.endedAt));
        conditions.push(gt(impersonationSessions.expiresAt, new Date()));
      }

      const impersonator = alias(usersLive, 'impersonator');
      const target = alias(usersLive, 'target_user');
      const verifier = alias(usersLive, 'otp_verifier');

      const rows = await tx
        .select({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          impersonatorName: impersonator.username,
          targetUserId: impersonationSessions.targetUserId,
          targetUserName: target.username,
          targetTenantId: impersonationSessions.targetTenantId,
          targetTenantName: institutesLive.name,
          reason: impersonationSessions.reason,
          ipAddress: impersonationSessions.ipAddress,
          userAgent: impersonationSessions.userAgent,
          startedAt: impersonationSessions.startedAt,
          expiresAt: impersonationSessions.expiresAt,
          endedAt: impersonationSessions.endedAt,
          endedReason: impersonationSessions.endedReason,
          otpVerifiedAt: impersonationSessions.otpVerifiedAt,
          otpVerifiedByName: verifier.username,
        })
        .from(impersonationSessions)
        .leftJoin(impersonator, eq(impersonator.id, impersonationSessions.impersonatorId))
        .leftJoin(target, eq(target.id, impersonationSessions.targetUserId))
        .leftJoin(verifier, eq(verifier.id, impersonationSessions.otpVerifiedBy))
        .leftJoin(institutesLive, eq(institutesLive.id, impersonationSessions.targetTenantId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(impersonationSessions.startedAt))
        .limit(opts.limit);

      return { rows, roles: await this.findImpersonatorRoleNames(tx, rows) };
    });
  }

  /**
   * The role lives in a different membership table per scope: platform → platform_memberships,
   * reseller → reseller_memberships, institute → memberships (scoped to the session's target
   * tenant). Batched per scope: at most three extra queries however many sessions returned.
   */
  private async findImpersonatorRoleNames(
    tx: DrizzleDB,
    rows: { impersonatorScope: string; impersonatorId: string; targetTenantId: string | null }[],
  ): Promise<ImpersonatorRoleNames> {
    const idsFor = (scope: string) => [
      ...new Set(rows.filter((r) => r.impersonatorScope === scope).map((r) => r.impersonatorId)),
    ];
    const platformIds = idsFor('platform');
    const resellerIds = idsFor('reseller');
    const institutePairs = rows.filter(
      (r) => r.impersonatorScope === 'institute' && r.targetTenantId,
    );

    const roles = emptyRoleNames();

    if (platformIds.length) {
      const found = await tx
        .select({ userId: platformMembershipsLive.userId, roleName: rolesLive.name })
        .from(platformMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, platformMembershipsLive.roleId))
        .where(inArray(platformMembershipsLive.userId, platformIds));
      for (const r of found) roles.platform.set(r.userId, r.roleName);
    }

    if (resellerIds.length) {
      const found = await tx
        .select({ userId: resellerMembershipsLive.userId, roleName: rolesLive.name })
        .from(resellerMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
        .where(
          and(
            inArray(resellerMembershipsLive.userId, resellerIds),
            eq(resellerMembershipsLive.isActive, true),
          ),
        );
      // First active reseller membership wins — display only.
      for (const r of found)
        if (!roles.reseller.has(r.userId)) roles.reseller.set(r.userId, r.roleName);
    }

    if (institutePairs.length) {
      const userIds = [...new Set(institutePairs.map((p) => p.impersonatorId))];
      const tenantIds = [...new Set(institutePairs.map((p) => p.targetTenantId as string))];
      const found = await tx
        .select({
          userId: membershipsLive.userId,
          tenantId: membershipsLive.tenantId,
          roleName: rolesLive.name,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            inArray(membershipsLive.userId, userIds),
            inArray(membershipsLive.tenantId, tenantIds),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        );
      for (const r of found) roles.institute.set(`${r.userId}:${r.tenantId}`, r.roleName);
    }

    return roles;
  }

  async hasActiveResellerMembership(params: {
    membershipId: string;
    userId: string;
    resellerId: string;
  }): Promise<boolean> {
    const [membership] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: resellerMembershipsLive.id })
        .from(resellerMembershipsLive)
        .where(
          and(
            eq(resellerMembershipsLive.id, params.membershipId),
            eq(resellerMembershipsLive.userId, params.userId),
            eq(resellerMembershipsLive.resellerId, params.resellerId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    return membership !== undefined;
  }

  async findActiveUserRolesInInstitute(userId: string, tenantId: string): Promise<RankedRole[]> {
    return withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          name: sql<string>`${rolesLive.name}->>'en'`,
          abilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .innerJoin(usersLive, eq(usersLive.id, membershipsLive.userId))
        .where(
          and(
            eq(membershipsLive.userId, userId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
            eq(usersLive.status, 'ACTIVE'),
          ),
        ),
    );
  }

  async findActiveActorMembership(params: {
    membershipId: string;
    userId: string;
    tenantId: string;
  }): Promise<ImpersonationActorMembership | null> {
    const [actorMembership] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          roleId: membershipsLive.roleId,
          roleName: sql<string>`${rolesLive.name}->>'en'`,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.id, params.membershipId),
            eq(membershipsLive.userId, params.userId),
            eq(membershipsLive.tenantId, params.tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .limit(1),
    );
    return actorMembership ?? null;
  }

  async hasActiveResellerMembershipOf(userId: string, resellerId: string): Promise<boolean> {
    const [teammate] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: resellerMembershipsLive.id })
        .from(resellerMembershipsLive)
        .where(
          and(
            eq(resellerMembershipsLive.userId, userId),
            eq(resellerMembershipsLive.resellerId, resellerId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    return teammate !== undefined;
  }

  async findPlatformRoleAbilities(userId: string): Promise<RankedRole['abilities'] | null> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ abilities: rolesLive.abilities })
        .from(platformMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, platformMembershipsLive.roleId))
        .where(
          and(
            eq(platformMembershipsLive.userId, userId),
            eq(platformMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    return row ? row.abilities : null;
  }

  async findResellerRoleName(userId: string, resellerId: string): Promise<string | null> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ roleName: sql<string>`${rolesLive.name}->>'en'` })
        .from(resellerMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
        .where(
          and(
            eq(resellerMembershipsLive.userId, userId),
            eq(resellerMembershipsLive.resellerId, resellerId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    return row ? row.roleName : null;
  }

  async createSession(values: NewImpersonationSession): Promise<string> {
    const [session] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx.insert(impersonationSessions).values(values).returning({ id: impersonationSessions.id }),
    );
    return session.id;
  }

  async findInstituteAdminUserId(tenantId: string): Promise<string | null> {
    const [adminRow] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          userId: membershipsLive.userId,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
            sql`${rolesLive.name}->>'en' = ${DefaultRoles.InstituteAdmin}`,
          ),
        )
        // Longest-standing admin, so the recipient is the same on every request.
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id))
        .limit(1),
    );
    return adminRow ? adminRow.userId : null;
  }

  async findPrimaryPhone(userId: string): Promise<{ countryCode: string; number: string } | null> {
    const [phoneRow] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          countryCode: phoneNumbersLive.countryCode,
          number: phoneNumbersLive.number,
        })
        .from(phoneNumbersLive)
        .where(and(eq(phoneNumbersLive.userId, userId), eq(phoneNumbersLive.isPrimary, true)))
        .limit(1),
    );
    return phoneRow ?? null;
  }
}

function emptyRoleNames(): ImpersonatorRoleNames {
  return {
    platform: new Map<string, I18nContent>(),
    reseller: new Map<string, I18nContent>(),
    institute: new Map<string, I18nContent>(),
  };
}
