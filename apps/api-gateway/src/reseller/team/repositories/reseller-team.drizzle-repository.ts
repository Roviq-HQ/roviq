import { Inject, Injectable } from '@nestjs/common';
import { ACTIVITY_EVENT_TYPES, type ResellerTier } from '@roviq/common-types';
import {
  authEvents,
  DRIZZLE_DB,
  type DrizzleDB,
  type I18nContent,
  mkAdminCtx,
  mkResellerCtx,
  refreshTokensLive,
  resellerMemberships,
  resellerMembershipsLive,
  resellersLive,
  rolesLive,
  userProfilesLive,
  usersLive,
  withAdmin,
  withReseller,
} from '@roviq/database';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  max,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  ResellerTeamRepository,
  type TeamListQuery,
  type TeamMemberRecord,
  type TeamRoleRecord,
  type TeamSessionRecord,
} from './reseller-team.repository';

const CTX = 'repository:reseller-team';

const memberColumns = {
  id: resellerMembershipsLive.id,
  userId: usersLive.id,
  email: usersLive.email,
  username: usersLive.username,
  roleId: resellerMembershipsLive.roleId,
  isActive: resellerMembershipsLive.isActive,
  joinedAt: resellerMembershipsLive.createdAt,
  firstName: userProfilesLive.firstName,
  lastName: userProfilesLive.lastName,
  profileImageFileId: userProfilesLive.profileImageFileId,
};

interface MemberRow {
  id: string;
  userId: string;
  email: string;
  username: string;
  roleId: string;
  isActive: boolean;
  joinedAt: Date;
  firstName: I18nContent | null;
  lastName: I18nContent | null;
  profileImageFileId: string | null;
}

function toRecord(row: MemberRow): TeamMemberRecord {
  const { firstName, lastName, profileImageFileId, ...member } = row;
  return {
    ...member,
    profile: firstName ? { firstName, lastName, profileImageFileId } : null,
  };
}

@Injectable()
export class ResellerTeamDrizzleRepository extends ResellerTeamRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async list(
    resellerId: string,
    query: TeamListQuery,
  ): Promise<{ rows: TeamMemberRecord[]; totalCount: number }> {
    const search = query.search?.trim();
    const filters: (SQL | undefined)[] = [eq(resellerMembershipsLive.resellerId, resellerId)];
    if (query.isActive !== undefined) {
      filters.push(eq(resellerMembershipsLive.isActive, query.isActive));
    }
    if (search && search.length >= 2) {
      filters.push(
        or(
          ilike(usersLive.username, `%${search}%`),
          ilike(usersLive.email, `%${search}%`),
          sql`${userProfilesLive.searchVector} @@ plainto_tsquery('simple', ${search})`,
        ),
      );
    }

    return withReseller(this.db, mkResellerCtx(resellerId, CTX), async (tx) => {
      const base = () =>
        tx
          .select(memberColumns)
          .from(resellerMembershipsLive)
          .innerJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id));

      const [totals, rows] = await Promise.all([
        tx
          .select({ value: count() })
          .from(resellerMembershipsLive)
          .innerJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
          .where(and(...filters)),
        base()
          .where(
            and(
              ...filters,
              query.afterId ? gt(resellerMembershipsLive.id, query.afterId) : undefined,
            ),
          )
          .orderBy(asc(resellerMembershipsLive.id))
          .limit(query.first),
      ]);
      return { rows: rows.map(toRecord), totalCount: totals[0]?.value ?? 0 };
    });
  }

  async findMember(resellerId: string, membershipId: string): Promise<TeamMemberRecord | null> {
    return this.findOne(resellerId, eq(resellerMembershipsLive.id, membershipId));
  }

  async findMemberByUser(resellerId: string, userId: string): Promise<TeamMemberRecord | null> {
    return this.findOne(resellerId, eq(resellerMembershipsLive.userId, userId));
  }

  async findTier(resellerId: string): Promise<ResellerTier | null> {
    const [row] = await withReseller(this.db, mkResellerCtx(resellerId, CTX), (tx) =>
      tx
        .select({ tier: resellersLive.tier })
        .from(resellersLive)
        .where(eq(resellersLive.id, resellerId))
        .limit(1),
    );
    return row?.tier ?? null;
  }

  async listRoles(resellerId: string): Promise<TeamRoleRecord[]> {
    // roviq_reseller cannot read roles; the reseller id is the caller's own, from the token.
    return withAdmin(this.db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ id: rolesLive.id, name: rolesLive.name })
        .from(rolesLive)
        .where(and(eq(rolesLive.scope, 'reseller'), eq(rolesLive.resellerId, resellerId))),
    );
  }

  async findLastActive(userIds: string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    // roviq_reseller cannot read auth_events; callers pass only their own staff's user ids.
    const rows = await withAdmin(this.db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ userId: authEvents.userId, lastActiveAt: max(authEvents.createdAt) })
        .from(authEvents)
        .where(
          and(
            inArray(authEvents.userId, userIds),
            inArray(authEvents.eventType, ACTIVITY_EVENT_TYPES),
          ),
        )
        .groupBy(authEvents.userId),
    );
    const out = new Map<string, Date>();
    for (const row of rows) {
      if (row.userId && row.lastActiveAt) out.set(row.userId, row.lastActiveAt);
    }
    return out;
  }

  async listSessions(membershipId: string): Promise<TeamSessionRecord[]> {
    // roviq_reseller cannot read refresh_tokens; callers pass a membership they looked up
    // under their own reseller first.
    return withAdmin(this.db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({
          id: refreshTokensLive.id,
          ipAddress: refreshTokensLive.ipAddress,
          userAgent: refreshTokensLive.userAgent,
          deviceInfo: refreshTokensLive.deviceInfo,
          createdAt: refreshTokensLive.createdAt,
          lastUsedAt: refreshTokensLive.lastUsedAt,
          expiresAt: refreshTokensLive.expiresAt,
        })
        .from(refreshTokensLive)
        .where(
          and(
            eq(refreshTokensLive.membershipId, membershipId),
            eq(refreshTokensLive.membershipScope, 'reseller'),
            isNull(refreshTokensLive.revokedAt),
            gt(refreshTokensLive.expiresAt, sql`now()`),
          ),
        )
        .orderBy(desc(refreshTokensLive.createdAt)),
    );
  }

  async updateRole(
    resellerId: string,
    membershipId: string,
    roleId: string,
    actorId: string,
  ): Promise<void> {
    await withReseller(this.db, mkResellerCtx(resellerId, CTX), (tx) =>
      tx
        .update(resellerMemberships)
        .set({ roleId, updatedBy: actorId })
        .where(
          and(
            eq(resellerMemberships.id, membershipId),
            eq(resellerMemberships.resellerId, resellerId),
          ),
        ),
    );
  }

  async setActive(
    resellerId: string,
    membershipId: string,
    isActive: boolean,
    actorId: string,
  ): Promise<void> {
    await withReseller(this.db, mkResellerCtx(resellerId, CTX), (tx) =>
      tx
        .update(resellerMemberships)
        .set({ isActive, updatedBy: actorId })
        .where(
          and(
            eq(resellerMemberships.id, membershipId),
            eq(resellerMemberships.resellerId, resellerId),
          ),
        ),
    );
  }

  private async findOne(resellerId: string, condition: SQL): Promise<TeamMemberRecord | null> {
    const [row] = await withReseller(this.db, mkResellerCtx(resellerId, CTX), (tx) =>
      tx
        .select(memberColumns)
        .from(resellerMembershipsLive)
        .innerJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
        .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
        .where(and(eq(resellerMembershipsLive.resellerId, resellerId), condition))
        .limit(1),
    );
    return row ? toRecord(row) : null;
  }
}
