import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  membershipsLive,
  mkResellerCtx,
  rolesLive,
  userProfilesLive,
  usersLive,
  withReseller,
} from '@roviq/database';
import { and, asc, count, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { ResellerUserRepository } from './reseller-user.repository';
import type { ResellerUserListQuery, ResellerUserListResult } from './types';

@Injectable()
export class ResellerUserDrizzleRepository extends ResellerUserRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  /** WHERE conditions from the query, starting with the reseller-scoped base condition */
  private buildListConditions(query: ResellerUserListQuery): SQL[] {
    // Base condition: users who have at least one membership in the reseller's institutes.
    // The `withReseller` context ensures `institutes` RLS restricts to this reseller's institutes.
    // `_live` views excludes soft-deleted rows, so explicit deleted_at filters are redundant.
    const userSubquery = sql`EXISTS (
      SELECT 1 FROM memberships_live m
      INNER JOIN institutes_live i ON i.id = m.tenant_id
      WHERE m.user_id = ${usersLive.id}
    )`;

    const conditions: SQL[] = [userSubquery];

    if (query.search) {
      const searchTerm = query.search.trim();
      if (searchTerm.length >= 2) {
        const tsQuery = searchTerm
          .split(/\s+/)
          .map((w) => `${w}:*`)
          .join(' & ');
        const searchCondition = or(
          sql`${userProfilesLive.searchVector} @@ to_tsquery('simple', ${tsQuery})`,
          sql`${usersLive.username} ILIKE ${`%${searchTerm}%`}`,
        );
        if (searchCondition) conditions.push(searchCondition);
      } else {
        const pattern = `%${searchTerm}%`;
        const searchCondition = or(
          sql`${userProfilesLive.searchVector} @@ plainto_tsquery('simple', ${searchTerm})`,
          sql`${usersLive.username} ILIKE ${pattern}`,
        );
        if (searchCondition) conditions.push(searchCondition);
      }
    }

    if (query.instituteId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM memberships_live m
          WHERE m.user_id = ${usersLive.id}
          AND m.tenant_id = ${query.instituteId}
        )`,
      );
    }

    if (query.membershipStatus && query.membershipStatus.length > 0) {
      const statusList = query.membershipStatus.map((s) => `'${s}'`).join(',');
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM memberships_live m
          INNER JOIN institutes_live i ON i.id = m.tenant_id
          WHERE m.user_id = ${usersLive.id}
          AND m.status IN (${sql.raw(statusList)})
        )`,
      );
    }

    if (query.afterId) {
      conditions.push(sql`${usersLive.id} > ${query.afterId}`);
    }

    return conditions;
  }

  async list(resellerId: string, query: ResellerUserListQuery): Promise<ResellerUserListResult> {
    return withReseller(this.db, mkResellerCtx(resellerId, 'service:reseller-user'), async (tx) => {
      const conditions = this.buildListConditions(query);
      const where = and(...conditions);
      const limit = query.limit;

      const [totalResult, userRows] = await Promise.all([
        tx
          .select({ value: count() })
          .from(usersLive)
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
          .where(where),
        tx
          .select({
            id: usersLive.id,
            email: usersLive.email,
            username: usersLive.username,
            status: usersLive.status,
            createdAt: usersLive.createdAt,
            firstName: userProfilesLive.firstName,
            lastName: userProfilesLive.lastName,
            profileImageFileId: userProfilesLive.profileImageFileId,
          })
          .from(usersLive)
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
          .where(where)
          .orderBy(asc(usersLive.createdAt))
          .limit(limit + 1),
      ]);

      const hasNextPage = userRows.length > limit;
      const nodes = hasNextPage ? userRows.slice(0, limit) : userRows;

      // Batch-load memberships scoped to this reseller's institutes
      const userIds = nodes.map((u) => u.id);
      const memberships =
        userIds.length > 0
          ? await tx
              .select({
                id: membershipsLive.id,
                userId: membershipsLive.userId,
                tenantId: membershipsLive.tenantId,
                roleId: membershipsLive.roleId,
                roleName: rolesLive.name,
                status: membershipsLive.status,
                instituteName: institutesLive.name,
              })
              .from(membershipsLive)
              .innerJoin(institutesLive, eq(institutesLive.id, membershipsLive.tenantId))
              .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
              .where(inArray(membershipsLive.userId, userIds))
          : [];

      return { totalCount: totalResult[0]?.value ?? 0, hasNextPage, nodes, memberships };
    });
  }
}
