import { Module } from '@nestjs/common';
import { ProfileDrizzleRepository } from './profile.drizzle-repository';
import { ProfileRepository } from './profile.repository';

@Module({
  providers: [{ provide: ProfileRepository, useClass: ProfileDrizzleRepository }],
  exports: [ProfileRepository],
})
export class ProfileRepositoryModule {}
