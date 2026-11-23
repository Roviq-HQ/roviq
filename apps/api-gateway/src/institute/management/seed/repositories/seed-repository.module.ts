import { Module } from '@nestjs/common';
import { InstituteSeederDrizzleRepository } from './institute-seeder.drizzle-repository';
import { InstituteSeederRepository } from './institute-seeder.repository';
import { InstituteSetupDrizzleRepository } from './institute-setup.drizzle-repository';
import { InstituteSetupRepository } from './institute-setup.repository';

@Module({
  providers: [
    { provide: InstituteSeederRepository, useClass: InstituteSeederDrizzleRepository },
    { provide: InstituteSetupRepository, useClass: InstituteSetupDrizzleRepository },
  ],
  exports: [InstituteSeederRepository, InstituteSetupRepository],
})
export class SeedRepositoryModule {}
