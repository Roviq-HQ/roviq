import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  mkResellerCtx,
  resellerMemberships,
  resellerMembershipsLive,
  userProfilesLive,
  usersLive,
  withAdmin,
  withReseller,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { IdentityService } from '../../auth/identity.service';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { ResellerInviteTeamMemberInput } from './dto/reseller-invite-team-member.input';
import type { ResellerTeamFilterInput } from './dto/reseller-team-filter.input';

@Injectable()
export class ResellerTeamService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly identityService: IdentityService,
  ) {}

  /**
   * List users who hold an active reseller-scope membership in this reseller.
   * Uses `withReseller` so RLS enforces visibility to the caller's reseller.
   */
  async list(resellerId: string, filter: ResellerTeamFilterInput) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'service:reseller-team'), async (tx) => {
      const searchCondition =
        filter.search && filter.search.trim().length >= 2
          ? or(
              ilike(usersLive.username, `%${filter.search.trim()}%`),
              sql`${userProfilesLive.searchVector} @@ plainto_tsquery('simple', ${filter.search.trim()})`,
            )
          : undefined;

      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (filter.after) {
        const cursor = decodeCursor(filter.after);
        if (cursor.id) {
          cursorCondition = sql`${resellerMembershipsLive.id} > ${cursor.id as string}`;
        }
      }

      const where = and(
        eq(resellerMembershipsLive.resellerId, resellerId),
        eq(resellerMembershipsLive.isActive, true),
        searchCondition,
        cursorCondition,
      );

      const limit = filter.first ?? 20;

      const [totalResult, rows] = await Promise.all([
        tx
          .select({ value: count() })
          .from(resellerMembershipsLive)
          .leftJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, resellerMembershipsLive.userId))
          .where(where),
        tx
          .select({
            membershipId: resellerMembershipsLive.id,
            roleId: resellerMembershipsLive.roleId,
            isActive: resellerMembershipsLive.isActive,
            membershipCreatedAt: resellerMembershipsLive.createdAt,
            userId: usersLive.id,
            email: usersLive.email,
            username: usersLive.username,
            userCreatedAt: usersLive.createdAt,
            firstName: userProfilesLive.firstName,
            lastName: userProfilesLive.lastName,
            profileImageUrl: userProfilesLive.profileImageUrl,
          })
          .from(resellerMembershipsLive)
          .innerJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, resellerMembershipsLive.userId))
          .where(where)
          .orderBy(asc(resellerMembershipsLive.createdAt))
          .limit(limit + 1),
      ]);

      const hasNextPage = rows.length > limit;
      const nodes = hasNextPage ? rows.slice(0, limit) : rows;

      const edges = nodes.map((row) => ({
        node: {
          id: row.userId,
          email: row.email,
          username: row.username,
          membershipId: row.membershipId,
          roleId: row.roleId,
          isActive: row.isActive,
          createdAt: row.userCreatedAt,
          profile:
            row.firstName != null
              ? {
                  firstName: row.firstName,
                  lastName: row.lastName,
                  profileImageUrl: row.profileImageUrl,
                }
              : null,
        },
        cursor: encodeCursor({ id: row.membershipId }),
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!filter.after,
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
        },
        totalCount: totalResult[0]?.value ?? 0,
      };
    });
  }

  /**
   * Invite a new user and immediately create their reseller-scope membership.
   * Delegates user + membership creation to IdentityService so the welcome
   * notification (temp password) is delivered via Novu automatically.
   */
  async invite(
    resellerId: string,
    actorId: string,
    input: ResellerInviteTeamMemberInput,
  ): Promise<{ membershipId: string }> {
    // Guard: the supplied roleId must belong to this reseller (not another tenant's role)
    const [roleRow] = await withAdmin(this.db, mkAdminCtx('service:reseller-team'), (tx) =>
      tx
        .select({ id: resellerMembershipsLive.roleId })
        .from(resellerMembershipsLive)
        .where(
          and(
            eq(resellerMembershipsLive.resellerId, resellerId),
            eq(resellerMembershipsLive.roleId, input.roleId),
          ),
        )
        .limit(1),
    );

    // If there are no existing memberships for this reseller yet, we allow the
    // first invite without the role-belongs-to-reseller check. For subsequent
    // invites the role must already be in use by this reseller.
    const membershipCount = await withReseller(
      this.db,
      mkResellerCtx(resellerId, 'service:reseller-team'),
      (tx) =>
        tx
          .select({ value: count() })
          .from(resellerMembershipsLive)
          .where(eq(resellerMembershipsLive.resellerId, resellerId))
          .then((r) => r[0]?.value ?? 0),
    );

    if (membershipCount > 0 && !roleRow) {
      throw new ForbiddenException('Supplied roleId does not belong to this reseller');
    }

    const result = await this.identityService.createUserWithMembership({
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      scope: 'reseller',
      resellerId,
      roleId: input.roleId,
      actorId,
    });

    return { membershipId: result.membershipId };
  }

  /**
   * Deactivate a team member's reseller-scope membership.
   * The user account and all other memberships remain intact.
   */
  async remove(resellerId: string, membershipId: string): Promise<void> {
    const [existing] = await withReseller(
      this.db,
      mkResellerCtx(resellerId, 'service:reseller-team'),
      (tx) =>
        tx
          .select({
            id: resellerMembershipsLive.id,
            resellerId: resellerMembershipsLive.resellerId,
          })
          .from(resellerMembershipsLive)
          .where(
            and(
              eq(resellerMembershipsLive.id, membershipId),
              eq(resellerMembershipsLive.resellerId, resellerId),
            ),
          )
          .limit(1),
    );

    if (!existing) {
      throw new ConflictException('Team member not found in this reseller');
    }

    await withReseller(this.db, mkResellerCtx(resellerId, 'service:reseller-team'), (tx) =>
      tx
        .update(resellerMemberships)
        .set({ isActive: false, updatedBy: getRequestContext().userId })
        .where(eq(resellerMemberships.id, membershipId)),
    );
  }
}
