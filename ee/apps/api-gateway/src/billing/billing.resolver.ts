import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AbilityGuard, CheckAbility, CurrentAbility, GqlAuthGuard } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import { BillingService } from './billing.service';
import { AssignPlanInput } from './dto/assign-plan.input';
import { BillingFilterInput } from './dto/billing-filter.input';
import { CreatePlanInput } from './dto/create-plan.input';
import { ManageSubscriptionInput } from './dto/manage-subscription.input';
import { SubscriptionFilterInput } from './dto/subscription-filter.input';
import { UpdatePlanInput } from './dto/update-plan.input';
import { AssignPlanResult } from './models/assign-plan-result.model';
import { InvoiceConnection } from './models/invoice.model';
import { OrganizationRef } from './models/organization-ref.model';
import { SubscriptionConnection, SubscriptionModel } from './models/subscription.model';
import { SubscriptionPlanModel } from './models/subscription-plan.model';

@Resolver()
export class BillingResolver {
  constructor(private readonly billingService: BillingService) {}

  @Mutation(() => SubscriptionPlanModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('create', 'SubscriptionPlan')
  async createSubscriptionPlan(@Args('input') input: CreatePlanInput) {
    return this.billingService.createPlan(input);
  }

  @Mutation(() => SubscriptionPlanModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('update', 'SubscriptionPlan')
  async updateSubscriptionPlan(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdatePlanInput,
  ) {
    return this.billingService.updatePlan(id, input);
  }

  @Mutation(() => AssignPlanResult)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('create', 'Subscription')
  async assignPlanToOrganization(
    @Args('input') input: AssignPlanInput,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.assignPlanToOrganization(input, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async cancelSubscription(
    @Args('input') input: ManageSubscriptionInput,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.cancelSubscription(input.subscriptionId, input.atCycleEnd, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async pauseSubscription(
    @Args('subscriptionId', { type: () => ID }) subscriptionId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.pauseSubscription(subscriptionId, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async resumeSubscription(
    @Args('subscriptionId', { type: () => ID }) subscriptionId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.resumeSubscription(subscriptionId, ability);
  }

  @Query(() => [OrganizationRef])
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'Organization')
  async organizations() {
    return this.billingService.findAllOrganizations();
  }

  @Query(() => [SubscriptionPlanModel])
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'SubscriptionPlan')
  async subscriptionPlans(@CurrentAbility() ability: AppAbility) {
    return this.billingService.findAllPlans(ability);
  }

  @Query(() => SubscriptionPlanModel)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'SubscriptionPlan')
  async subscriptionPlan(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.findPlan(id, ability);
  }

  @Query(() => SubscriptionModel, { nullable: true })
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'Subscription')
  async subscription(
    @Args('organizationId', { type: () => ID }) organizationId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.findSubscription(organizationId, ability);
  }

  @Query(() => SubscriptionConnection)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'Subscription')
  async subscriptions(
    @CurrentAbility() ability: AppAbility,
    @Args('filter', { nullable: true }) filter?: SubscriptionFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.billingService.findAllSubscriptions({ filter, first, after, ability });
  }

  @Query(() => InvoiceConnection)
  @UseGuards(GqlAuthGuard, AbilityGuard)
  @CheckAbility('read', 'Invoice')
  async invoices(
    @CurrentAbility() ability: AppAbility,
    @Args('organizationId', { type: () => ID, nullable: true }) organizationId?: string,
    @Args('filter', { nullable: true }) filter?: BillingFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.billingService.findInvoices({ organizationId, filter, first, after, ability });
  }
}
