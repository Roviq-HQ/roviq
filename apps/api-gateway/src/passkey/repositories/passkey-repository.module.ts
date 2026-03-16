import { Module } from '@nestjs/common';
import { AuthProviderDrizzleRepository } from './auth-provider.drizzle-repository';
import { AuthProviderRepository } from './auth-provider.repository';

@Module({
  providers: [{ provide: AuthProviderRepository, useClass: AuthProviderDrizzleRepository }],
  exports: [AuthProviderRepository],
})
export class PasskeyRepositoryModule {}
