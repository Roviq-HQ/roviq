import { Field, ID, ObjectType } from '@nestjs/graphql';
import { PaymentMethod, PaymentStatus } from '@roviq/ee-billing-types';
import type { payments } from '@roviq/ee-database';
import { GraphQLBigInt } from 'graphql-scalars';

type PaymentRow = typeof payments.$inferSelect;

@ObjectType()
export class PaymentModel {
  @Field(() => ID)
  id!: string;

  @Field()
  invoiceId!: string;

  @Field()
  tenantId!: string;

  @Field(() => PaymentStatus)
  status!: PaymentRow['status'];

  @Field(() => PaymentMethod)
  method!: PaymentRow['method'];

  @Field(() => GraphQLBigInt)
  amountPaise!: bigint;

  @Field()
  currency!: string;

  @Field(() => String, { nullable: true })
  gatewayProvider!: string | null;

  @Field(() => String, { nullable: true })
  gatewayPaymentId!: string | null;

  @Field(() => String, { nullable: true })
  receiptNumber!: string | null;

  @Field(() => Date, { nullable: true })
  paidAt!: Date | null;

  @Field()
  createdAt!: Date;
}
