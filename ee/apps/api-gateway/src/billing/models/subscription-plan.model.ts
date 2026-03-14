import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { BillingInterval, type FeatureLimits } from '@roviq/ee-billing-types';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class SubscriptionPlanModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int)
  amount!: number;

  @Field()
  currency!: string;

  @Field(() => BillingInterval)
  billingInterval!: BillingInterval;

  @Field(() => GraphQLJSON)
  featureLimits!: FeatureLimits;

  @Field()
  isActive!: boolean;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
