import { Module } from '@nestjs/common';
import { AdmissionDrizzleRepository } from './admission.drizzle-repository';
import { AdmissionRepository } from './admission.repository';

@Module({
  providers: [{ provide: AdmissionRepository, useClass: AdmissionDrizzleRepository }],
  exports: [AdmissionRepository],
})
export class AdmissionRepositoryModule {}
