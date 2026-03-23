import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

@InputType()
export class VerifyPaymentGqlInput {
  @Field()
  @IsString()
  gatewayOrderId!: string;

  @Field()
  @IsString()
  gatewayPaymentId!: string;

  @Field()
  @IsString()
  signature!: string;
}
