import { Field, ObjectType } from '@nestjs/graphql';
import { SubscriptionModel } from './subscription.model';

@ObjectType()
export class AssignPlanResult {
  @Field(() => SubscriptionModel)
  subscription!: SubscriptionModel;

  @Field(() => String, { nullable: true })
  checkoutUrl?: string;
}
