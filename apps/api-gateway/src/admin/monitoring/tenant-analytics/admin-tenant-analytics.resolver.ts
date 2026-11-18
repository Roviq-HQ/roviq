import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import {
  assertPlatformContext,
  CurrentUser,
  GqlAuthGuard,
  PlatformScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { AdminTenantAnalyticsArgs } from './dto/tenant-analytics.args';
import { TenantAnalyticsConnection } from './models/tenant-analytics.model';
import { TenantAnalyticsService } from './tenant-analytics.service';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminTenantAnalyticsResolver {
  constructor(private readonly service: TenantAnalyticsService) {}

  @Query(() => TenantAnalyticsConnection, {
    description: 'Platform admin: per-institute active users and API usage (ROV-184)',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  async adminTenantAnalytics(
    @Args() args: AdminTenantAnalyticsArgs,
    @CurrentUser() user: AuthUser,
  ): Promise<TenantAnalyticsConnection> {
    assertPlatformContext(user);
    return this.service.list(user, args);
  }
}
