import { Module } from '@nestjs/common';
import { AcademicYearDrizzleRepository } from './academic-year.drizzle-repository';
import { AcademicYearRepository } from './academic-year.repository';

@Module({
  providers: [{ provide: AcademicYearRepository, useClass: AcademicYearDrizzleRepository }],
  exports: [AcademicYearRepository],
})
export class AcademicYearRepositoryModule {}
