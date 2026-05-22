import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { BillingReadDrizzleRepository } from './billing-read.drizzle-repository';
import { BillingReadRepository } from './billing-read.repository';
import { NotificationConfigReadDrizzleRepository } from './notification-config-read.drizzle-repository';
import { NotificationConfigReadRepository } from './notification-config-read.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: NotificationConfigReadRepository,
      useClass: NotificationConfigReadDrizzleRepository,
    },
    {
      provide: BillingReadRepository,
      useClass: BillingReadDrizzleRepository,
    },
  ],
  exports: [NotificationConfigReadRepository, BillingReadRepository],
})
export class NotificationServiceRepositoryModule {}
