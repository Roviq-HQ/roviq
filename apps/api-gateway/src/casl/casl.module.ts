import { Global, Module } from '@nestjs/common';
import { AbilityFactory, AbilityGuard } from '@roviq/casl';
import { PlatformDatabaseModule } from '@roviq/nestjs-prisma';

@Global()
@Module({
  imports: [PlatformDatabaseModule],
  providers: [AbilityFactory, AbilityGuard],
  exports: [AbilityFactory, AbilityGuard],
})
export class CaslModule {}
