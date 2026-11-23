import { Module } from '@nestjs/common';
import { ResellerUserRepositoryModule } from './repositories/reseller-user-repository.module';
import { ResellerUserResolver } from './reseller-user.resolver';
import { ResellerUserService } from './reseller-user.service';

@Module({
  imports: [ResellerUserRepositoryModule],
  providers: [ResellerUserService, ResellerUserResolver],
})
export class ResellerUserModule {}
