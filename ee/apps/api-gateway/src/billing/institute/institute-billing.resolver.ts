import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, InstituteScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility, CurrentAbility } from '@roviq/casl';
import type { AppAbility, AuthUser } from '@roviq/common-types';
import { BillingService } from '../billing.service';
import { BillingFilterInput } from '../dto/billing-filter.input';
import { InvoiceConnection } from '../models/invoice.model';
import { SubscriptionModel } from '../models/subscription.model';

/**
 * Institute-scoped billing resolver.
 * Institutes can view their own subscription and invoices — read-only.
 */
@Resolver()
@InstituteScope()
export class InstituteBillingResolver {
  constructor(private readonly billingService: BillingService) {}

  @Query(() => SubscriptionModel, { nullable: true, name: 'mySubscription' })
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Subscription')
  async mySubscription(@CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility) {
    if (!user.tenantId) return null;
    return this.billingService.findSubscription(user.tenantId, ability);
  }

  @Query(() => InvoiceConnection, { name: 'myInvoices' })
  @UseGuards(AbilityGuard)
  @CheckAbility('read', 'Invoice')
  async myInvoices(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Args('filter', { nullable: true }) filter?: BillingFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    return this.billingService.findInvoices({
      instituteId: user.tenantId ?? undefined,
      filter,
      first,
      after,
      ability,
    });
  }
}
