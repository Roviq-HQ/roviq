import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { EventBusModule } from '@roviq/event-bus';
import { TelemetryModule } from '@roviq/telemetry';
import { TemporalClientModule } from '@roviq/temporal';
import { type NotificationEnv, validate } from '../config/env.validation';
import { InstitutePortal } from '../config/institute-portal';
import { BillingNotificationController } from '../controllers/billing-notification.controller';
import { SmsWebhookController } from '../controllers/sms-webhook.controller';
import { WhatsAppWebhookController } from '../controllers/whatsapp-webhook.controller';
import { buildChannelAdapters, ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { ConsentGate, GuardianConsentGate } from '../delivery/consent-gate';
import { SmsHttp } from '../delivery/sms/sms-http';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { HealthController } from '../health/health.controller';
import { NotificationWorkerHealthIndicator } from '../health/worker.health';
import { ApprovalListener } from '../listeners/approval.listener';
import { ArrivalListener } from '../listeners/arrival.listener';
import { AttendanceListener } from '../listeners/attendance.listener';
import { AuthListener } from '../listeners/auth.listener';
import { FeeListener } from '../listeners/fee.listener';
import { LeaveListener } from '../listeners/leave.listener';
import { UserListener } from '../listeners/user.listener';
import { NatsJetStreamModule } from '../nats/nats-jetstream.module';
import { ContactReadRepository } from '../repositories/contact-read.repository';
import { NotificationServiceRepositoryModule } from '../repositories/notification-service-repository.module';
import { NotificationWriteRepository } from '../repositories/notification-write.repository';
import { FlowArrivals } from '../services/flow-arrivals.service';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import { SmsWebhookService } from '../services/sms-webhook.service';
import { WhatsAppWebhookService } from '../services/whatsapp-webhook.service';
import { NotificationWorkerService } from '../workflows/notification.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TelemetryModule,
    NotificationServiceRepositoryModule,
    NatsJetStreamModule,
    EventBusModule,
    TemporalClientModule,
    TerminusModule,
  ],
  controllers: [
    HealthController,
    BillingNotificationController,
    WhatsAppWebhookController,
    SmsWebhookController,
    ApprovalListener,
    ArrivalListener,
    AttendanceListener,
    AuthListener,
    FeeListener,
    LeaveListener,
    UserListener,
  ],
  providers: [
    {
      provide: ChannelAdapters,
      useFactory: (
        config: ConfigService<NotificationEnv, true>,
        contacts: ContactReadRepository,
        whatsapp: WhatsAppCloud,
        sms: SmsHttp,
      ) =>
        buildChannelAdapters(
          {
            NOTIFICATION_EMAIL_PROVIDER: config.get('NOTIFICATION_EMAIL_PROVIDER', { infer: true }),
            NOTIFICATION_PUSH_PROVIDER: config.get('NOTIFICATION_PUSH_PROVIDER', { infer: true }),
            NOTIFICATION_SMS_PROVIDER: config.get('NOTIFICATION_SMS_PROVIDER', { infer: true }),
            NOTIFICATION_WHATSAPP_PROVIDER: config.get('NOTIFICATION_WHATSAPP_PROVIDER', {
              infer: true,
            }),
            SMTP_URL: config.get('SMTP_URL', { infer: true }),
            EMAIL_FROM: config.get('EMAIL_FROM', { infer: true }),
            FCM_SERVICE_ACCOUNT_JSON: config.get('FCM_SERVICE_ACCOUNT_JSON', { infer: true }),
          },
          contacts,
          whatsapp,
          sms,
        ),
      inject: [ConfigService, ContactReadRepository, WhatsAppCloud, SmsHttp],
    },
    { provide: ConsentGate, useClass: GuardianConsentGate },
    {
      provide: ChannelSender,
      useFactory: (
        adapters: ChannelAdapters,
        consent: ConsentGate,
        contacts: ContactReadRepository,
        writes: NotificationWriteRepository,
        whatsapp: WhatsAppRoute,
      ) => new ChannelSender(adapters, consent, contacts, writes, whatsapp),
      inject: [
        ChannelAdapters,
        ConsentGate,
        ContactReadRepository,
        NotificationWriteRepository,
        WhatsAppRoute,
      ],
    },
    WhatsAppCloud,
    SmsHttp,
    WhatsAppRoute,
    Clock,
    NotificationDispatcher,
    FlowArrivals,
    RetryWait,
    InstitutePortal,
    RecipientResolver,
    WhatsAppWebhookService,
    SmsWebhookService,
    NotificationWorkerService,
    NotificationWorkerHealthIndicator,
  ],
})
export class AppModule {}
