import { Field, ID, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class InitiatePaymentResult {
  @Field(() => ID)
  paymentId!: string;

  @Field()
  gatewayOrderId!: string;

  @Field(() => String, { nullable: true })
  checkoutUrl!: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  checkoutPayload!: Record<string, unknown> | null;
}
