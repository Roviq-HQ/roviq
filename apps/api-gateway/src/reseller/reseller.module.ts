import { Module } from '@nestjs/common';
import { ResellerInstituteSubscriptionResolver } from './institute/reseller-institute.subscription';

@Module({
  providers: [ResellerInstituteSubscriptionResolver],
})
export class ResellerModule {}
