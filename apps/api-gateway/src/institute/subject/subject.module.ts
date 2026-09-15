import { Module } from '@nestjs/common';
import { AcademicYearRepositoryModule } from '../../academic-year/repositories/academic-year-repository.module';
import { SubjectRepositoryModule } from './repositories/subject-repository.module';
import { SubjectResolver } from './subject.resolver';
import { SubjectService } from './subject.service';

@Module({
  imports: [SubjectRepositoryModule, AcademicYearRepositoryModule],
  providers: [SubjectService, SubjectResolver],
  exports: [SubjectService],
})
export class SubjectModule {}
