import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DlqModule } from '../dlq/dlq.module';
import { FilesModule } from '../files/files.module';
import { InstituteGroupModule } from '../institute/institute-group/institute-group.module';
import { InstituteModule } from '../institute/management/institute.module';
import { InstituteSetupModule } from '../institute/setup/institute-setup.module';
import { AdminAttendanceModule } from './attendance/admin-attendance.module';
import { AdminAuditResolver } from './audit/admin-audit.resolver';
import { AdminComplianceExportModule } from './compliance-export/admin-compliance-export.module';
import { AdminDlqResolver } from './dlq/admin-dlq.resolver';
import { DlqInstituteNameLoader } from './dlq/dlq-institute-name.loader';
import { AdminImpersonationResolver } from './impersonation/admin-impersonation.resolver';
import { AdminImpersonationSubscriptionResolver } from './impersonation/admin-impersonation.subscription';
import { AdminInstituteLoaders } from './institute/admin-institute.loaders';
import { AdminInstituteResolver } from './institute/admin-institute.resolver';
import { AdminInstituteService } from './institute/admin-institute.service';
import { AdminInstituteSubscriptionResolver } from './institute/admin-institute.subscription';
import { AdminInstituteFieldResolver } from './institute/admin-institute-field.resolver';
import { AdminInstituteRepositoryModule } from './institute/repositories/admin-institute-repository.module';
import { AdminInstituteGroupResolver } from './institute-group/admin-institute-group.resolver';
import { AdminMessagingModule } from './messaging/admin-messaging.module';
import { AdminMonitoringModule } from './monitoring/admin-monitoring.module';
import { AdminNotificationHealthModule } from './monitoring/notification-health/admin-notification-health.module';
import { AdminTenantAnalyticsModule } from './monitoring/tenant-analytics/admin-tenant-analytics.module';
import { AdminNotificationModule } from './notification/admin-notification.module';
import { AdminResellerResolver } from './reseller/admin-reseller.resolver';
import { AdminResellerService } from './reseller/admin-reseller.service';
import { AdminResellerSubscriptionResolver } from './reseller/admin-reseller.subscription';
import { AdminResellerRepositoryModule } from './reseller/repositories/admin-reseller-repository.module';
import { AdminUserModule } from './user/admin-user.module';

@Module({
  imports: [
    FilesModule,
    AuthModule, // provides AuthEventService
    AuditModule, // provides AuditService
    DlqModule, // provides DlqService
    InstituteGroupModule, // provides InstituteGroupService for admin group operations
    InstituteModule, // provides InstituteService for admin institute operations
    InstituteSetupModule, // runs the setup workflow that approval starts (ROV-232)
    AdminUserModule,
    AdminInstituteRepositoryModule,
    AdminResellerRepositoryModule,
    AdminAttendanceModule, // cross-tenant attendance summary (ROV admin attendance view)
    AdminMonitoringModule, // system health + tenant analytics (ROV-184)
    AdminTenantAnalyticsModule,
    AdminNotificationHealthModule,
    AdminComplianceExportModule, // compliance exports of any institute (ROV-296)
    AdminNotificationModule, // notification delivery log for support (ROV-314)
    AdminMessagingModule, // WhatsApp senders and usage (ROV-319)
  ],
  providers: [
    AdminResellerService,
    AdminResellerResolver,
    AdminResellerSubscriptionResolver,
    AdminInstituteGroupResolver,
    AdminInstituteService,
    AdminInstituteResolver,
    AdminInstituteFieldResolver, // admin-only resellerName/groupName on InstituteModel
    AdminInstituteLoaders, // request-scoped DataLoaders for the field resolver
    AdminInstituteSubscriptionResolver,
    AdminImpersonationResolver,
    AdminImpersonationSubscriptionResolver,
    AdminAuditResolver,
    AdminDlqResolver,
    DlqInstituteNameLoader,
  ],
})
export class AdminModule {}
