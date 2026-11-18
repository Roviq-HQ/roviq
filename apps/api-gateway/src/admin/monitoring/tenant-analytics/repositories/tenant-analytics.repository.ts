import type { PlatformContext } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

export interface TenantInstituteRecord {
  instituteId: string;
  instituteName: I18nContent;
  resellerId: string;
  resellerName: string;
}

export interface TenantActiveUsersRecord {
  tenantId: string;
  activeUsers: number;
}

export abstract class TenantAnalyticsRepository {
  abstract listInstitutes(
    ctx: PlatformContext,
    resellerId: string | null,
  ): Promise<TenantInstituteRecord[]>;

  abstract countActiveUsersSince(
    ctx: PlatformContext,
    since: Date,
  ): Promise<TenantActiveUsersRecord[]>;
}
