import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PaymentsModule } from '@roviq/ee-payments';
import { PlatformDatabaseModule } from '@roviq/nestjs-prisma';
import './billing.enums';
import { BillingRepository } from './billing.repository';
import { BillingResolver } from './billing.resolver';
import { BillingService } from './billing.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    PlatformDatabaseModule,
    PaymentsModule,
    ClientsModule.registerAsync([
      {
        name: 'BILLING_NATS_CLIENT',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [config.getOrThrow<string>('NATS_URL')],
          },
        }),
      },
    ]),
  ],
  controllers: [WebhookController],
  providers: [BillingRepository, BillingService, BillingResolver],
})
export class BillingModule {}
