import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InstituteModule } from '../institute/management/institute.module';
import { AdminInstituteResolver } from './institute/admin-institute.resolver';
import { AdminInstituteService } from './institute/admin-institute.service';
import { AdminInstituteSubscriptionResolver } from './institute/admin-institute.subscription';
import { AdminResellerResolver } from './reseller/admin-reseller.resolver';
import { AdminResellerService } from './reseller/admin-reseller.service';

@Module({
  imports: [
    AuthModule, // provides AuthEventService
    InstituteModule, // provides InstituteService for admin institute operations
  ],
  providers: [
    AdminResellerService,
    AdminResellerResolver,
    AdminInstituteService,
    AdminInstituteResolver,
    AdminInstituteSubscriptionResolver,
  ],
})
export class AdminModule {}
