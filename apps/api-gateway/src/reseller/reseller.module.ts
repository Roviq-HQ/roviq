import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { InstituteGroupModule } from '../institute/institute-group/institute-group.module';
import { InstituteModule } from '../institute/management/institute.module';
import { ResellerAuditResolver } from './audit/reseller-audit.resolver';
import { ResellerImpersonationResolver } from './impersonation/reseller-impersonation.resolver';
import { ResellerInstituteResolver } from './institute/reseller-institute.resolver';
import { ResellerInstituteService } from './institute/reseller-institute.service';
import { ResellerInstituteSubscriptionResolver } from './institute/reseller-institute.subscription';
import { ResellerInstituteGroupResolver } from './institute-group/reseller-institute-group.resolver';
import { ResellerInstituteGroupService } from './institute-group/reseller-institute-group.service';
import { ResellerSettingsModule } from './settings/reseller-settings.module';
import { ResellerTeamModule } from './team/reseller-team.module';
import { ResellerUserModule } from './user/reseller-user.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    InstituteModule,
    InstituteGroupModule,
    ResellerUserModule,
    ResellerTeamModule,
    ResellerSettingsModule,
  ],
  providers: [
    ResellerInstituteSubscriptionResolver,
    ResellerInstituteResolver,
    ResellerInstituteService,
    ResellerInstituteGroupResolver,
    ResellerInstituteGroupService,
    ResellerImpersonationResolver,
    ResellerAuditResolver,
  ],
})
export class ResellerModule {}
