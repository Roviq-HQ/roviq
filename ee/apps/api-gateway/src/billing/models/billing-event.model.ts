import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description:
    'A subscription changed (created, paused, resumed, cancelled, expired or moved to another plan). Carries ids only: refetch the subscription to read its new state.',
})
export class BillingSubscriptionEvent {
  @Field(() => ID)
  subscriptionId!: string;

  @Field(() => ID, { description: 'Institute the subscription belongs to' })
  tenantId!: string;
}

@ObjectType({
  description: 'An invoice was generated. Carries ids only: refetch the invoice to read it.',
})
export class BillingInvoiceEvent {
  @Field(() => ID)
  invoiceId!: string;

  @Field(() => ID, { description: 'Institute the invoice was raised for' })
  tenantId!: string;
}

@ObjectType({
  description:
    'A payment was received or changed state (UPI proof submitted, verified, rejected, refunded). Carries ids only: refetch the payment or its invoice.',
})
export class BillingPaymentEvent {
  @Field(() => ID)
  paymentId!: string;

  @Field(() => ID)
  invoiceId!: string;

  @Field(() => ID, { description: 'Institute that owes the invoice' })
  tenantId!: string;
}
