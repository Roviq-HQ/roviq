import { Module } from '@nestjs/common';
import { PrismaModule } from '@roviq/nestjs-prisma';
import { NotificationConfigPrismaRepository } from './notification-config.prisma-repository';
import { NotificationConfigRepository } from './notification-config.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: NotificationConfigRepository,
      useClass: NotificationConfigPrismaRepository,
    },
  ],
  exports: [NotificationConfigRepository],
})
export class NotificationConfigRepositoryModule {}
