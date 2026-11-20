import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';

@InputType()
export class VerifyPaymentGqlInput {
  @Field()
  @IsString()
  gatewayOrderId!: string;

  @Field({
    nullable: true,
    description: 'razorpay_payment_id from Razorpay Checkout. Not used for Cashfree.',
  })
  @IsOptional()
  @IsString()
  gatewayPaymentId?: string;

  @Field({
    nullable: true,
    description: 'razorpay_signature from Razorpay Checkout. Not used for Cashfree.',
  })
  @IsOptional()
  @IsString()
  signature?: string;
}
