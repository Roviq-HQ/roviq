import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, ResellerScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility, CurrentAbility } from '@roviq/casl';
import type { AppAbility, AuthUser } from '@roviq/common-types';
import { BillingService } from '../billing.service';
import { AssignPlanInput } from '../dto/assign-plan.input';
import { BillingFilterInput } from '../dto/billing-filter.input';
import { CreatePlanInput } from '../dto/create-plan.input';
import { ManageSubscriptionInput } from '../dto/manage-subscription.input';
import { SubscriptionFilterInput } from '../dto/subscription-filter.input';
import { UpdatePlanInput } from '../dto/update-plan.input';
import { AssignPlanResult } from '../models/assign-plan-result.model';
import { InstituteRef } from '../models/institute-ref.model';
import { InvoiceConnection } from '../models/invoice.model';
import { SubscriptionConnection, SubscriptionModel } from '../models/subscription.model';
import { SubscriptionPlanModel } from '../models/subscription-plan.model';
import { PlanService } from './plan.service';

/** Extract resellerId from JWT — guaranteed present by @ResellerScope() guard */
function resellerId(user: AuthUser): string {
  if (!user.resellerId)
    throw new Error('resellerId missing — ResellerScope guard should prevent this');
  return user.resellerId;
}

/**
 * Reseller-scoped billing resolver.
 * Plan CRUD, subscription assignment, invoices — all reseller operations.
 * resellerId auto-extracted from JWT via @CurrentUser().
 */
@Resolver()
@ResellerScope()
export class ResellerBillingResolver {
  constructor(
    private readonly billingService: BillingService,
    private readonly planService: PlanService,
  ) {}

  // ---------------------------------------------------------------------------
  // Plans (ROV-114 — PlanRepository + PlanService, withReseller)
  // ---------------------------------------------------------------------------

  @Query(() => [SubscriptionPlanModel], { name: 'subscriptionPlans' })
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'SubscriptionPlan')
  async resellerListPlans(
    @CurrentUser() user: AuthUser,
    @Args('status', { nullable: true }) status?: string,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    const { items } = await this.planService.listPlans(resellerId(user), {
      status,
      first: first ?? 20,
      after,
    });
    return items;
  }

  @Query(() => SubscriptionPlanModel, { name: 'subscriptionPlan' })
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'SubscriptionPlan')
  async resellerGetPlan(@CurrentUser() user: AuthUser, @Args('id', { type: () => ID }) id: string) {
    return this.planService.getPlan(resellerId(user), id);
  }

  @Mutation(() => SubscriptionPlanModel, { name: 'createSubscriptionPlan' })
  @UseGuards(AbilityGuard)
  @CheckAbility('create', 'SubscriptionPlan')
  async resellerCreatePlan(@CurrentUser() user: AuthUser, @Args('input') input: CreatePlanInput) {
    return this.planService.createPlan(resellerId(user), input);
  }

  @Mutation(() => SubscriptionPlanModel, { name: 'updateSubscriptionPlan' })
  @UseGuards(AbilityGuard)
  @CheckAbility('update', 'SubscriptionPlan')
  async resellerUpdatePlan(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdatePlanInput,
  ) {
    return this.planService.updatePlan(resellerId(user), id, input);
  }

  @Mutation(() => Boolean, { name: 'deletePlan' })
  @UseGuards(AbilityGuard)
  @CheckAbility('delete', 'SubscriptionPlan')
  async resellerDeletePlan(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ) {
    await this.planService.deletePlan(resellerId(user), id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Subscriptions (will be refactored to SubscriptionService in ROV-116)
  // ---------------------------------------------------------------------------

  @Mutation(() => AssignPlanResult)
  @UseGuards(AbilityGuard)
  @CheckAbility('create', 'Subscription')
  async assignPlanToInstitute(
    @Args('input') input: AssignPlanInput,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.assignPlanToInstitute(input, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async cancelSubscription(
    @Args('input') input: ManageSubscriptionInput,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.cancelSubscription(input.subscriptionId, input.atCycleEnd, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async pauseSubscription(
    @Args('subscriptionId', { type: () => ID }) subscriptionId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.pauseSubscription(subscriptionId, ability);
  }

  @Mutation(() => SubscriptionModel)
  @UseGuards(AbilityGuard)
  @CheckAbility('update', 'Subscription')
  async resumeSubscription(
    @Args('subscriptionId', { type: () => ID }) subscriptionId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.resumeSubscription(subscriptionId, ability);
  }

  @Query(() => SubscriptionConnection)
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Subscription')
  async subscriptions(
    @CurrentAbility() ability: AppAbility,
    @Args('filter', { nullable: true }) filter?: SubscriptionFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.billingService.findAllSubscriptions({ filter, first, after, ability });
  }

  @Query(() => SubscriptionModel, { nullable: true })
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Subscription')
  async subscription(
    @Args('instituteId', { type: () => ID }) instituteId: string,
    @CurrentAbility() ability: AppAbility,
  ) {
    return this.billingService.findSubscription(instituteId, ability);
  }

  // ---------------------------------------------------------------------------
  // Invoices & Institutes
  // ---------------------------------------------------------------------------

  @Query(() => InvoiceConnection)
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Invoice')
  async invoices(
    @CurrentAbility() ability: AppAbility,
    @Args('instituteId', { type: () => ID, nullable: true }) instituteId?: string,
    @Args('filter', { nullable: true }) filter?: BillingFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.billingService.findInvoices({ instituteId, filter, first, after, ability });
  }

  @Query(() => [InstituteRef])
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Institute')
  async billingInstitutes() {
    return this.billingService.findAllInstitutes();
  }
}
