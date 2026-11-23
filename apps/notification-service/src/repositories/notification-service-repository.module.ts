import { Module } from '@nestjs/common';
import { DatabaseModule } from '@roviq/database';
import { BillingReadDrizzleRepository } from './billing-read.drizzle-repository';
import { BillingReadRepository } from './billing-read.repository';
import { ConsentReadDrizzleRepository } from './consent-read.drizzle-repository';
import { ConsentReadRepository } from './consent-read.repository';
import { ContactReadDrizzleRepository } from './contact-read.drizzle-repository';
import { ContactReadRepository } from './contact-read.repository';
import { MessagingInboundDrizzleRepository } from './messaging-inbound.drizzle-repository';
import { MessagingInboundRepository } from './messaging-inbound.repository';
import { MessagingSenderDrizzleRepository } from './messaging-sender.drizzle-repository';
import { MessagingSenderRepository } from './messaging-sender.repository';
import { NotificationConfigReadDrizzleRepository } from './notification-config-read.drizzle-repository';
import { NotificationConfigReadRepository } from './notification-config-read.repository';
import { NotificationWriteDrizzleRepository } from './notification-write.drizzle-repository';
import { NotificationWriteRepository } from './notification-write.repository';
import { RecipientReadDrizzleRepository } from './recipient-read.drizzle-repository';
import { RecipientReadRepository } from './recipient-read.repository';

const REPOSITORIES = [
  { provide: NotificationConfigReadRepository, useClass: NotificationConfigReadDrizzleRepository },
  { provide: BillingReadRepository, useClass: BillingReadDrizzleRepository },
  { provide: RecipientReadRepository, useClass: RecipientReadDrizzleRepository },
  { provide: ContactReadRepository, useClass: ContactReadDrizzleRepository },
  { provide: ConsentReadRepository, useClass: ConsentReadDrizzleRepository },
  { provide: MessagingInboundRepository, useClass: MessagingInboundDrizzleRepository },
  { provide: MessagingSenderRepository, useClass: MessagingSenderDrizzleRepository },
  { provide: NotificationWriteRepository, useClass: NotificationWriteDrizzleRepository },
];

@Module({
  imports: [DatabaseModule],
  providers: REPOSITORIES,
  exports: REPOSITORIES.map((r) => r.provide),
})
export class NotificationServiceRepositoryModule {}
