import { Module } from '@nestjs/common';
import { AdminInstituteDrizzleRepository } from './admin-institute.drizzle-repository';
import { AdminInstituteRepository } from './admin-institute.repository';

@Module({
  providers: [{ provide: AdminInstituteRepository, useClass: AdminInstituteDrizzleRepository }],
  exports: [AdminInstituteRepository],
})
export class AdminInstituteRepositoryModule {}
