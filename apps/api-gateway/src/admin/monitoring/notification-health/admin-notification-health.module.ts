import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { AdminMonitoringModule } from '../admin-monitoring.module';
import { AdminNotificationHealthResolver } from './admin-notification-health.resolver';
import { NotificationHealthService } from './notification-health.service';
import { NotificationHealthDrizzleRepository } from './repositories/notification-health.drizzle-repository';
import { NotificationHealthRepository } from './repositories/notification-health.repository';

@Module({
  imports: [DatabaseModule, AdminMonitoringModule],
  providers: [
    { provide: NotificationHealthRepository, useClass: NotificationHealthDrizzleRepository },
    NotificationHealthService,
    AdminNotificationHealthResolver,
  ],
})
export class AdminNotificationHealthModule {}
