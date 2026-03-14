import { Field, InputType, Int } from '@nestjs/graphql';
import { BillingInterval, type FeatureLimits } from '@roviq/ee-billing-types';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class UpdatePlanInput {
  @Field({ nullable: true })
  @IsString()
  @MinLength(2)
  @IsOptional()
  name?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  description?: string;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @Min(0)
  @IsOptional()
  amount?: number;

  @Field(() => BillingInterval, { nullable: true })
  @IsOptional()
  billingInterval?: BillingInterval;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  featureLimits?: FeatureLimits;

  @Field({ nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
