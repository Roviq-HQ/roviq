import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { AdminListUsersFilterInput } from './dto/admin-list-users-filter.input';
import { AdminUserRepository } from './repositories/admin-user.repository';

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class AdminUserService {
  constructor(private readonly repo: AdminUserRepository) {}

  async list(filter: AdminListUsersFilterInput) {
    const { edges, hasNextPage, totalCount } = await this.repo.list({
      ...filter,
      first: filter.first ?? DEFAULT_PAGE_SIZE,
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

  search(query: string, limit: number) {
    return this.repo.search(query, limit);
  }

  async getUser(userId: string) {
    const user = await this.repo.findDetail(userId);
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, 'User not found');
    return user;
  }

  statistics() {
    return this.repo.statistics(new Date());
  }
}
