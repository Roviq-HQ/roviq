import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@roviq/nestjs-prisma';
import { TelemetryModule } from '@roviq/telemetry';
import { validate } from '../config/env.validation';
import { NatsModule } from '../nats/nats.module';
import { NotificationTriggerService } from '../services/notification-trigger.service';
import { PreferenceLoaderService } from '../services/preference-loader.service';
import { SubscriberSyncService } from '../services/subscriber-sync.service';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TelemetryModule,
    PrismaModule,
    NatsModule,
  ],
  controllers: [AppController],
  providers: [NotificationTriggerService, SubscriberSyncService, PreferenceLoaderService],
})
export class AppModule {}
