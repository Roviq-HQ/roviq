import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { GuardianResolver } from './guardian.resolver';
import { GuardianService } from './guardian.service';
import { GuardianQueryService } from './guardian-query.service';
import { GuardianReadRepository } from './guardian-read.repository';

@Module({
  imports: [AuthModule],
  providers: [GuardianService, GuardianResolver, GuardianQueryService, GuardianReadRepository],
  exports: [GuardianService],
})
export class GuardianModule {}
