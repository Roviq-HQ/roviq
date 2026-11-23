import { ArgsType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const TENANT_ANALYTICS_SORT_FIELD_VALUES = [
  // Institute name (English value, falling back to the first locale present)
  'INSTITUTE_NAME',
  // Distinct users with a refresh token created or used in the last 24h
  'ACTIVE_USERS_24H',
  // API operations in the last 24h (OpenObserve); null values sort as zero
  'API_CALLS_24H',
  // Bytes of the institute's own stored files
  'STORAGE_USED',
] as const;
export type TenantAnalyticsSortField = (typeof TENANT_ANALYTICS_SORT_FIELD_VALUES)[number];
export const TenantAnalyticsSortField = Object.fromEntries(
  TENANT_ANALYTICS_SORT_FIELD_VALUES.map((v) => [v, v]),
) as { readonly [K in TenantAnalyticsSortField]: K };

registerEnumType(TenantAnalyticsSortField, {
  name: 'TenantAnalyticsSortField',
  description: 'Column the tenant analytics table is sorted by',
});

export const SORT_ORDER_VALUES = [
  // Smallest / alphabetically first value first
  'ASC',
  // Largest / alphabetically last value first
  'DESC',
] as const;
export type SortOrder = (typeof SORT_ORDER_VALUES)[number];
export const SortOrder = Object.fromEntries(SORT_ORDER_VALUES.map((v) => [v, v])) as {
  readonly [K in SortOrder]: K;
};

registerEnumType(SortOrder, { name: 'SortOrder', description: 'Sort direction' });

@ArgsType()
export class AdminTenantAnalyticsArgs {
  @Field(() => Int, { nullable: true, defaultValue: 25, description: 'Page size (1–100)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  first?: number | null;

  @Field(() => String, { nullable: true, description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  after?: string | null;

  @Field(() => TenantAnalyticsSortField, {
    nullable: true,
    defaultValue: TenantAnalyticsSortField.API_CALLS_24H,
  })
  @IsOptional()
  @IsEnum(TenantAnalyticsSortField)
  sortBy?: TenantAnalyticsSortField | null;

  @Field(() => SortOrder, { nullable: true, defaultValue: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder | null;

  @Field(() => ID, { nullable: true, description: 'Only institutes owned by this reseller' })
  @IsOptional()
  @IsUUID()
  resellerId?: string | null;
}
