import { Module } from '@nestjs/common';
import { AcademicYearRepositoryModule } from '../../academic-year/repositories/academic-year-repository.module';
import { StandardRepositoryModule } from './repositories/standard-repository.module';
import { StandardResolver } from './standard.resolver';
import { StandardService } from './standard.service';

@Module({
  imports: [StandardRepositoryModule, AcademicYearRepositoryModule],
  providers: [StandardService, StandardResolver],
  exports: [StandardService],
})
export class StandardModule {}
