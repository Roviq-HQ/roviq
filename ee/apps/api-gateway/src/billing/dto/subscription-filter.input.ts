import { Field, InputType } from '@nestjs/graphql';
import { SubscriptionStatus } from '@roviq/ee-billing-types';
import { IsOptional } from 'class-validator';

@InputType()
export class SubscriptionFilterInput {
  @Field(() => SubscriptionStatus, { nullable: true })
  @IsOptional()
  status?: SubscriptionStatus;
}
