import { Module } from '@nestjs/common';
import { SUBSCRIPTION_READER } from '@roviq/common-types';
import { EntitlementService } from './entitlement.service';

@Module({
  providers: [
    EntitlementService,
    // Default: no SubscriptionReader. EE BillingModule overrides this.
    { provide: SUBSCRIPTION_READER, useValue: undefined },
  ],
  exports: [EntitlementService],
})
export class EntitlementModule {}
