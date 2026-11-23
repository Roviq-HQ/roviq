import { Module } from '@nestjs/common';
import { ResellerUserDrizzleRepository } from './reseller-user.drizzle-repository';
import { ResellerUserRepository } from './reseller-user.repository';

@Module({
  providers: [{ provide: ResellerUserRepository, useClass: ResellerUserDrizzleRepository }],
  exports: [ResellerUserRepository],
})
export class ResellerUserRepositoryModule {}
