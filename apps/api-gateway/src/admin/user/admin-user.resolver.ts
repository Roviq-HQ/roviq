import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { AdminUserService } from './admin-user.service';
import { AdminListUsersFilterInput } from './dto/admin-list-users-filter.input';
import {
  AdminUserConnection,
  AdminUserDetailModel,
  AdminUserModel,
  AdminUserStatisticsModel,
} from './models/admin-user.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => AdminUserModel)
export class AdminUserResolver {
  constructor(private readonly service: AdminUserService) {}

  @Query(() => AdminUserConnection, {
    description: 'List all users, newest first, with search and filters (platform admin)',
  })
  @CheckAbility({ action: 'read', subject: 'User' })
  async adminListUsers(@Args('filter', { nullable: true }) filter?: AdminListUsersFilterInput) {
    return this.service.list(filter ?? {});
  }

  @Query(() => [AdminUserModel], {
    description: 'Typeahead search for users by name, username, email or phone (platform admin)',
  })
  @CheckAbility({ action: 'read', subject: 'User' })
  async adminSearchUsers(
    @Args('query') query: string,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
  ) {
    return this.service.search(query, Math.min(Math.max(limit, 1), 50));
  }

  @Query(() => AdminUserDetailModel, {
    description: 'One user with profile, all memberships, identifiers, documents and addresses',
  })
  @CheckAbility({ action: 'read', subject: 'User' })
  async adminGetUser(@Args('userId', { type: () => ID }, ParseUUIDPipe) userId: string) {
    return this.service.getUser(userId);
  }

  @Query(() => AdminUserStatisticsModel, { description: 'Headline user counts (platform admin)' })
  @CheckAbility({ action: 'read', subject: 'User' })
  async adminUserStatistics() {
    return this.service.statistics();
  }
}
