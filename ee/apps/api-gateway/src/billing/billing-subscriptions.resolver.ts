import { UseGuards } from '@nestjs/common';
import { Resolver, Subscription } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard, ResellerScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { pubSub } from '@roviq/pubsub';
import { InvoiceModel } from './models/invoice.model';
import { PaymentModel } from './models/payment.model';
import { SubscriptionModel } from './models/subscription.model';

// ---------------------------------------------------------------------------
// Institute-scoped subscriptions
// ---------------------------------------------------------------------------

@Resolver()
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
export class InstituteBillingSubscriptions {
  @Subscription(() => SubscriptionModel, {
    name: 'mySubscriptionStatusChanged',
    filter: (
      payload: { tenantId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').InstituteContext },
    ) => payload.tenantId === context.user.tenantId,
  })
  @CheckAbility({ action: 'read', subject: 'Subscription' })
  mySubscriptionStatusChanged() {
    return pubSub.asyncIterableIterator('BILLING.subscription.status_changed');
  }

  @Subscription(() => InvoiceModel, {
    name: 'myInvoiceGenerated',
    filter: (
      payload: { tenantId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').InstituteContext },
    ) => payload.tenantId === context.user.tenantId,
  })
  @CheckAbility({ action: 'read', subject: 'Invoice' })
  myInvoiceGenerated() {
    return pubSub.asyncIterableIterator('BILLING.invoice.generated');
  }

  @Subscription(() => PaymentModel, {
    name: 'myPaymentStatusChanged',
    filter: (
      payload: { tenantId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').InstituteContext },
    ) => payload.tenantId === context.user.tenantId,
  })
  @CheckAbility({ action: 'read', subject: 'Payment' })
  myPaymentStatusChanged() {
    return pubSub.asyncIterableIterator('BILLING.payment.status_changed');
  }
}

// ---------------------------------------------------------------------------
// Reseller-scoped subscriptions
// ---------------------------------------------------------------------------

@Resolver()
@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
export class ResellerBillingSubscriptions {
  @Subscription(() => InvoiceModel, {
    name: 'resellerInvoiceGenerated',
    filter: (
      payload: { resellerId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').ResellerContext },
    ) => payload.resellerId === context.user.resellerId,
  })
  @CheckAbility({ action: 'read', subject: 'Invoice' })
  resellerInvoiceGenerated() {
    return pubSub.asyncIterableIterator('BILLING.invoice.generated');
  }

  @Subscription(() => PaymentModel, {
    name: 'resellerPaymentReceived',
    filter: (
      payload: { resellerId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').ResellerContext },
    ) => payload.resellerId === context.user.resellerId,
  })
  @CheckAbility({ action: 'read', subject: 'Payment' })
  resellerPaymentReceived() {
    return pubSub.asyncIterableIterator('BILLING.payment.succeeded');
  }

  @Subscription(() => SubscriptionModel, {
    name: 'resellerSubscriptionChanged',
    filter: (
      payload: { resellerId: string },
      _args: unknown,
      context: { user: import('@roviq/common-types').ResellerContext },
    ) => payload.resellerId === context.user.resellerId,
  })
  @CheckAbility({ action: 'read', subject: 'Subscription' })
  resellerSubscriptionChanged() {
    return pubSub.asyncIterableIterator('BILLING.subscription.status_changed');
  }
}
