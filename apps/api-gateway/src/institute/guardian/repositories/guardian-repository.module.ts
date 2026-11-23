import { Module } from '@nestjs/common';
import { GuardianDrizzleRepository } from './guardian.drizzle-repository';
import { GuardianRepository } from './guardian.repository';

@Module({
  providers: [{ provide: GuardianRepository, useClass: GuardianDrizzleRepository }],
  exports: [GuardianRepository],
})
export class GuardianRepositoryModule {}
