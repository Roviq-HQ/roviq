import { Field, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLBigInt } from 'graphql-scalars';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class BillingDashboardModel {
  /** Monthly Recurring Revenue in paise (normalized from all intervals) */
  @Field(() => GraphQLBigInt)
  mrr!: bigint;

  /** Total active subscriptions */
  @Field(() => Int)
  activeSubscriptions!: number;

  /** Subscriptions cancelled in last 30 days */
  @Field(() => Int)
  churnedLast30Days!: number;

  /** Churn rate: cancelled / (active + cancelled) in last 30 days */
  @Field()
  churnRate!: number;

  /** Count of overdue invoices */
  @Field(() => Int)
  overdueInvoiceCount!: number;

  /** Subscriptions grouped by status: { ACTIVE: 10, PAUSED: 2, ... } */
  @Field(() => GraphQLJSON)
  subscriptionsByStatus!: Record<string, number>;
}
