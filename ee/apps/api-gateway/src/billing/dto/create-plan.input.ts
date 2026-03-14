import { Field, InputType, Int } from '@nestjs/graphql';
import { BillingInterval, type FeatureLimits } from '@roviq/ee-billing-types';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
  MinLength,
} from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class CreatePlanInput {
  @Field()
  @IsString()
  @MinLength(2)
  name!: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  description?: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  amount!: number;

  @Field({ defaultValue: 'INR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @Field(() => BillingInterval)
  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @Field(() => GraphQLJSON)
  @IsObject()
  featureLimits!: FeatureLimits;
}
