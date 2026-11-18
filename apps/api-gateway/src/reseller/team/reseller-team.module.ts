import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ResellerTeamDrizzleRepository } from './repositories/reseller-team.drizzle-repository';
import { ResellerTeamRepository } from './repositories/reseller-team.repository';
import { ResellerTeamResolver } from './reseller-team.resolver';
import { ResellerTeamService } from './reseller-team.service';

@Module({
  imports: [AuthModule],
  providers: [
    ResellerTeamService,
    ResellerTeamResolver,
    { provide: ResellerTeamRepository, useClass: ResellerTeamDrizzleRepository },
  ],
})
export class ResellerTeamModule {}
