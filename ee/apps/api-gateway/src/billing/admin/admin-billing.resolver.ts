import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { BillingDashboardModel } from '../models/billing-dashboard.model';
import { DashboardService } from '../reseller/dashboard.service';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminBillingResolver {
  constructor(private readonly dashboardService: DashboardService) {}

  @Query(() => BillingDashboardModel, {
    description: "Platform admin: one reseller's billing summary (MRR, subscriptions, overdue)",
  })
  @CheckAbility({ action: 'read', subject: 'BillingDashboard' })
  async adminResellerBillingDashboard(@Args('resellerId', { type: () => ID }) resellerId: string) {
    return this.dashboardService.getDashboard(resellerId);
  }
}
