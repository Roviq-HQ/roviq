import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsModule } from '@roviq/ee-payments';
import { JetStreamClient } from '@roviq/nats-jetstream';
import './billing.enums';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { InstituteBillingResolver } from './institute/institute-billing.resolver';
import { PlanRepository } from './repositories/plan.repository';
import { PlanService } from './reseller/plan.service';
import { ResellerBillingResolver } from './reseller/reseller-billing.resolver';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [WebhookController],
  providers: [
    {
      provide: 'BILLING_NATS_CLIENT',
      useFactory: async (config: ConfigService) => {
        const client = new JetStreamClient({
          servers: [config.getOrThrow<string>('NATS_URL')],
        });
        await client.connect();
        return client;
      },
      inject: [ConfigService],
    },
    BillingRepository,
    PlanRepository,
    BillingService,
    PlanService,
    ResellerBillingResolver,
    InstituteBillingResolver,
  ],
})
export class BillingModule {}
