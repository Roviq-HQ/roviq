import { Field, ID, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class InitiatePaymentResult {
  @Field(() => ID)
  paymentId!: string;

  @Field()
  gatewayOrderId!: string;

  @Field({ description: 'Gateway that opens the checkout: RAZORPAY or CASHFREE' })
  gatewayProvider!: string;

  @Field(() => GraphQLJSON, {
    description:
      'Options for the gateway browser checkout. RAZORPAY: Razorpay Checkout options (key, order_id, amount, currency). CASHFREE: { paymentSessionId, mode }.',
  })
  checkoutPayload!: Record<string, unknown>;
}
