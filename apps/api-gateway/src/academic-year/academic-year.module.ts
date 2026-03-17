import { Module } from '@nestjs/common';
import { AcademicYearResolver } from './academic-year.resolver';
import { AcademicYearService } from './academic-year.service';
import { AcademicYearRepositoryModule } from './repositories/academic-year-repository.module';

@Module({
  imports: [AcademicYearRepositoryModule],
  providers: [AcademicYearService, AcademicYearResolver],
  exports: [AcademicYearService],
})
export class AcademicYearModule {}
