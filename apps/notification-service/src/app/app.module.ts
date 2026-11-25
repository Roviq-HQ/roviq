import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { EventBusModule } from '@roviq/event-bus';
import { REDIS_CLIENT, RedisModule } from '@roviq/redis';
import { TelemetryModule } from '@roviq/telemetry';
import { TemporalClientModule } from '@roviq/temporal';
import type Redis from 'ioredis';
import { type NotificationEnv, validate } from '../config/env.validation';
import { Portals } from '../config/portals';
import { BillingNotificationController } from '../controllers/billing-notification.controller';
import { SmsWebhookController } from '../controllers/sms-webhook.controller';
import { WhatsAppWebhookController } from '../controllers/whatsapp-webhook.controller';
import { buildChannelAdapters, ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { ConsentGate, GuardianConsentGate } from '../delivery/consent-gate';
import { ProviderBreaker } from '../delivery/rate/provider-breaker';
import { SenderRateLimiter } from '../delivery/rate/sender-rate-limiter';
import { SmsHttp } from '../delivery/sms/sms-http';
import { TemplateSendability } from '../delivery/whatsapp/template-sendability';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { HealthController } from '../health/health.controller';
import { NotificationWorkerHealthIndicator } from '../health/worker.health';
import { ApprovalListener } from '../listeners/approval.listener';
import { ArrivalListener } from '../listeners/arrival.listener';
import { AttendanceListener } from '../listeners/attendance.listener';
import { AuthListener } from '../listeners/auth.listener';
import { CanaryListener } from '../listeners/canary.listener';
import { FeeListener } from '../listeners/fee.listener';
import { LeaveListener } from '../listeners/leave.listener';
import { SectionListener } from '../listeners/section.listener';
import { TemplateSyncListener } from '../listeners/template-sync.listener';
import { UserListener } from '../listeners/user.listener';
import { NatsJetStreamModule } from '../nats/nats-jetstream.module';
import { ContactReadRepository } from '../repositories/contact-read.repository';
import { MessagingTemplateRepository } from '../repositories/messaging-template.repository';
import { NotificationServiceRepositoryModule } from '../repositories/notification-service-repository.module';
import { NotificationWriteRepository } from '../repositories/notification-write.repository';
import { DeliveryCanary } from '../services/delivery-canary.service';
import { FlowArrivals } from '../services/flow-arrivals.service';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import { SmsWebhookService } from '../services/sms-webhook.service';
import { TemplateSyncStarter } from '../services/template-sync-starter.service';
import { WhatsAppWebhookService } from '../services/whatsapp-webhook.service';
import { NotificationGauges } from '../telemetry/notification-gauges';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { NotificationStateGauges } from '../telemetry/notification-state-gauges';
import { NotificationWorkerService } from '../workflows/notification.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TelemetryModule,
    RedisModule,
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
    CanaryListener,
    FeeListener,
    LeaveListener,
    SectionListener,
    UserListener,
    TemplateSyncListener,
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
      provide: SenderRateLimiter,
      useFactory: (redis: Redis) => new SenderRateLimiter(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: ProviderBreaker,
      useFactory: (redis: Redis) => new ProviderBreaker(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: ChannelSender,
      useFactory: (
        adapters: ChannelAdapters,
        consent: ConsentGate,
        contacts: ContactReadRepository,
        writes: NotificationWriteRepository,
        whatsapp: WhatsAppRoute,
        metrics: NotificationMetrics,
        rate: SenderRateLimiter,
        breaker: ProviderBreaker,
      ) => new ChannelSender(adapters, consent, contacts, writes, whatsapp, metrics, rate, breaker),
      inject: [
        ChannelAdapters,
        ConsentGate,
        ContactReadRepository,
        NotificationWriteRepository,
        WhatsAppRoute,
        NotificationMetrics,
        SenderRateLimiter,
        ProviderBreaker,
      ],
    },
    WhatsAppCloud,
    SmsHttp,
    {
      provide: TemplateSendability,
      useFactory: (templates: MessagingTemplateRepository) => new TemplateSendability(templates),
      inject: [MessagingTemplateRepository],
    },
    WhatsAppRoute,
    Clock,
    NotificationDispatcher,
    FlowArrivals,
    RetryWait,
    Portals,
    RecipientResolver,
    WhatsAppWebhookService,
    SmsWebhookService,
    NotificationWorkerService,
    NotificationWorkerHealthIndicator,
    NotificationMetrics,
    NotificationGauges,
    NotificationStateGauges,
    DeliveryCanary,
    TemplateSyncStarter,
  ],
})
export class AppModule {}
