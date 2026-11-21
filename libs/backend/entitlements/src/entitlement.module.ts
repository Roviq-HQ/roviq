import { Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';

@Module({
  // SUBSCRIPTION_READER comes from the global EE BillingModule when EE is on; a provider
  // for it here would hide that one.
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
