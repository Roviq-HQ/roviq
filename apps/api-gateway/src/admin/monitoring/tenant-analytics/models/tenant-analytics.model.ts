import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar, PageInfo } from '@roviq/nestjs-graphql';

@ObjectType('TenantAnalytics', {
  description: 'Per-institute usage for the platform monitoring page',
})
export class TenantAnalyticsModel {
  @Field(() => ID)
  instituteId!: string;

  /** Multilingual via i18nText; resolved via useI18nField() on the frontend. */
  @Field(() => I18nTextScalar)
  instituteName!: I18nContent;

  @Field(() => ID)
  resellerId!: string;

  @Field()
  resellerName!: string;

  @Field(() => Int, {
    description: 'Distinct users with a refresh token created or used in the last 24h',
  })
  activeUsers24h!: number;

  @Field(() => Float, {
    description:
      "Bytes of the institute's own stored files. Files about a person (documents, photos) are not counted.",
  })
  storageUsedBytes!: number;

  @Field(() => Int, {
    nullable: true,
    description:
      'Institute-scope GraphQL operations in the last 24h; null when Prometheus is unavailable',
  })
  apiCalls24h!: number | null;

  @Field(() => [Int], {
    nullable: true,
    description:
      '7 daily API-call totals, oldest to newest (each a 24h window ending at that point); null when Prometheus is unavailable',
  })
  activityTrend7d!: number[] | null;
}

@ObjectType('TenantAnalyticsEdge')
export class TenantAnalyticsEdge {
  @Field()
  cursor!: string;

  @Field(() => TenantAnalyticsModel)
  node!: TenantAnalyticsModel;
}

@ObjectType('TenantAnalyticsConnection')
export class TenantAnalyticsConnection {
  @Field(() => [TenantAnalyticsEdge])
  edges!: TenantAnalyticsEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;

  @Field({
    description: 'False when Prometheus could not be queried; API-call columns are then null',
  })
  metricsAvailable!: boolean;
}
