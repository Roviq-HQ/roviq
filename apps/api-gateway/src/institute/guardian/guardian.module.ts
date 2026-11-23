import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SignInDetailsModule } from '../sign-in-details/sign-in-details.module';
import { GuardianResolver } from './guardian.resolver';
import { GuardianService } from './guardian.service';
import { GuardianQueryService } from './guardian-query.service';
import { GuardianReadRepository } from './guardian-read.repository';

@Module({
  imports: [AuthModule, SignInDetailsModule],
  providers: [GuardianService, GuardianResolver, GuardianQueryService, GuardianReadRepository],
  exports: [GuardianService],
})
export class GuardianModule {}
