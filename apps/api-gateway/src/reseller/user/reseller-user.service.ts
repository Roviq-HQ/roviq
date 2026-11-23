import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { ResellerListUsersFilterInput } from './dto/reseller-list-users-filter.input';
import { ResellerUserRepository } from './repositories/reseller-user.repository';
import type { ResellerUserMembershipRow } from './repositories/types';

@Injectable()
export class ResellerUserService {
  constructor(private readonly repo: ResellerUserRepository) {}

  /** List users who have memberships in institutes belonging to this reseller. */
  async list(resellerId: string, filter: ResellerListUsersFilterInput) {
    let afterId: string | undefined;
    if (filter.after) {
      const cursor = decodeCursor(filter.after);
      if (cursor.id) afterId = cursor.id as string;
    }

    const { totalCount, hasNextPage, nodes, memberships } = await this.repo.list(resellerId, {
      search: filter.search,
      instituteId: filter.instituteId,
      membershipStatus: filter.membershipStatus,
      afterId,
      limit: filter.first ?? 20,
    });

    const membershipsByUser = new Map<string, ResellerUserMembershipRow[]>();
    for (const row of memberships) {
      const existing = membershipsByUser.get(row.userId) ?? [];
      existing.push(row);
      membershipsByUser.set(row.userId, existing);
    }

    const edges = nodes.map((row) => {
      const userMemberships = membershipsByUser.get(row.id) ?? [];
      return {
        node: {
          id: row.id,
          email: row.email,
          username: row.username,
          status: row.status,
          createdAt: row.createdAt,
          profile: row.firstName
            ? {
                firstName: row.firstName,
                lastName: row.lastName,
                profileImageFileId: row.profileImageFileId,
              }
            : null,
          memberships: userMemberships.map((m) => ({
            id: m.id,
            tenantId: m.tenantId,
            roleId: m.roleId,
            roleName: m.roleName,
            status: m.status,
            instituteName: (m.instituteName as Record<string, string> | null)?.en ?? null,
          })),
        },
        cursor: encodeCursor({ id: row.id }),
      };
    });

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!filter.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount,
    };
  }
}
