import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { AdminMonitoringModule } from '../admin-monitoring.module';
import { AdminTenantAnalyticsResolver } from './admin-tenant-analytics.resolver';
import { TenantAnalyticsDrizzleRepository } from './repositories/tenant-analytics.drizzle-repository';
import { TenantAnalyticsRepository } from './repositories/tenant-analytics.repository';
import { TenantAnalyticsService } from './tenant-analytics.service';
import { TenantApiRequestsPlugin } from './tenant-api-requests.plugin';

@Module({
  imports: [DatabaseModule, AdminMonitoringModule],
  providers: [
    { provide: TenantAnalyticsRepository, useClass: TenantAnalyticsDrizzleRepository },
    TenantAnalyticsService,
    AdminTenantAnalyticsResolver,
    TenantApiRequestsPlugin,
  ],
})
export class AdminTenantAnalyticsModule {}
