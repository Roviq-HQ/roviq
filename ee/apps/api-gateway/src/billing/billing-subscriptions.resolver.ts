import { UseGuards } from '@nestjs/common';
import { Resolver, Subscription } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard, ResellerScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, type AbilityRequestContext, CheckAbility } from '@roviq/casl';
import { toSubscriptionKey } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { pubSub } from '@roviq/pubsub';
import {
  BillingInvoiceEvent,
  BillingPaymentEvent,
  BillingSubscriptionEvent,
} from './models/billing-event.model';

interface EventOwner {
  tenantId?: unknown;
  resellerId?: unknown;
}

// The event bus publishes each event under one camelCase key; the owner ids sit inside it.
type Published = Record<string, EventOwner | undefined>;

/** True only when the event names the caller's own institute. */
export function isOwnInstituteEvent(
  key: string,
  payload: Published,
  context: AbilityRequestContext,
): boolean {
  const user = context.req.user;
  const tenantId = payload[key]?.tenantId;
  return user.scope === 'institute' && typeof tenantId === 'string' && tenantId === user.tenantId;
}

/** True only when the event names the caller's own reseller. */
export function isOwnResellerEvent(
  key: string,
  payload: Published,
  context: AbilityRequestContext,
): boolean {
  const user = context.req.user;
  const resellerId = payload[key]?.resellerId;
  return (
    user.scope === 'reseller' && typeof resellerId === 'string' && resellerId === user.resellerId
  );
}

const SUBSCRIPTION_KEY = toSubscriptionKey(EVENT_PATTERNS.BILLING.subscription.status_changed);
const INVOICE_KEY = toSubscriptionKey(EVENT_PATTERNS.BILLING.invoice.generated);
const PAYMENT_KEY = toSubscriptionKey(EVENT_PATTERNS.BILLING.payment.status_changed);
const PAYMENT_SUCCEEDED_KEY = toSubscriptionKey(EVENT_PATTERNS.BILLING.payment.succeeded);

@Resolver()
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
export class InstituteBillingSubscriptions {
  @Subscription(() => BillingSubscriptionEvent, {
    name: 'mySubscriptionStatusChanged',
    description: "Fires when this institute's subscription changes",
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnInstituteEvent(SUBSCRIPTION_KEY, payload, context),
    resolve: (payload: Published) => payload[SUBSCRIPTION_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Subscription' })
  mySubscriptionStatusChanged() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.subscription.status_changed);
  }

  @Subscription(() => BillingInvoiceEvent, {
    name: 'myInvoiceGenerated',
    description: 'Fires when an invoice is raised for this institute',
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnInstituteEvent(INVOICE_KEY, payload, context),
    resolve: (payload: Published) => payload[INVOICE_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Invoice' })
  myInvoiceGenerated() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.invoice.generated);
  }

  @Subscription(() => BillingPaymentEvent, {
    name: 'myPaymentStatusChanged',
    description: "Fires when one of this institute's payments is received or changes state",
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnInstituteEvent(PAYMENT_KEY, payload, context),
    resolve: (payload: Published) => payload[PAYMENT_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Payment' })
  myPaymentStatusChanged() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.payment.status_changed);
  }
}

@Resolver()
@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
export class ResellerBillingSubscriptions {
  @Subscription(() => BillingInvoiceEvent, {
    name: 'resellerInvoiceGenerated',
    description: "Fires when an invoice is raised for one of this reseller's institutes",
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnResellerEvent(INVOICE_KEY, payload, context),
    resolve: (payload: Published) => payload[INVOICE_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Invoice' })
  resellerInvoiceGenerated() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.invoice.generated);
  }

  @Subscription(() => BillingPaymentEvent, {
    name: 'resellerPaymentReceived',
    description: 'Fires when money is captured or recorded against an invoice',
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnResellerEvent(PAYMENT_SUCCEEDED_KEY, payload, context),
    resolve: (payload: Published) => payload[PAYMENT_SUCCEEDED_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Payment' })
  resellerPaymentReceived() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.payment.succeeded);
  }

  @Subscription(() => BillingPaymentEvent, {
    name: 'resellerPaymentStatusChanged',
    description:
      'Fires on every payment change, including a UPI proof waiting for verification, a rejection and a refund',
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnResellerEvent(PAYMENT_KEY, payload, context),
    resolve: (payload: Published) => payload[PAYMENT_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Payment' })
  resellerPaymentStatusChanged() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.payment.status_changed);
  }

  @Subscription(() => BillingSubscriptionEvent, {
    name: 'resellerSubscriptionChanged',
    description: "Fires when a subscription of one of this reseller's institutes changes",
    filter: (payload: Published, _args: unknown, context: AbilityRequestContext) =>
      isOwnResellerEvent(SUBSCRIPTION_KEY, payload, context),
    resolve: (payload: Published) => payload[SUBSCRIPTION_KEY],
  })
  @CheckAbility({ action: 'read', subject: 'Subscription' })
  resellerSubscriptionChanged() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.BILLING.subscription.status_changed);
  }
}
