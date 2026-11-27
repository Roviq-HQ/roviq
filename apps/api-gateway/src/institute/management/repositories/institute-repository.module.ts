import { Module } from '@nestjs/common';
import { InstituteDrizzleRepository } from './institute.drizzle-repository';
import { InstituteRepository } from './institute.repository';
import { InstituteDetailsDrizzleRepository } from './institute-details.drizzle-repository';
import { InstituteDetailsRepository } from './institute-details.repository';
import { OwnInstituteDrizzleRepository } from './own-institute.drizzle-repository';
import { OwnInstituteRepository } from './own-institute.repository';

@Module({
  providers: [
    { provide: InstituteRepository, useClass: InstituteDrizzleRepository },
    { provide: OwnInstituteRepository, useClass: OwnInstituteDrizzleRepository },
    { provide: InstituteDetailsRepository, useClass: InstituteDetailsDrizzleRepository },
  ],
  exports: [InstituteRepository, OwnInstituteRepository, InstituteDetailsRepository],
})
export class InstituteRepositoryModule {}
