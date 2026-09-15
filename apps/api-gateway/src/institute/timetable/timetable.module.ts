import { Module } from '@nestjs/common';
import { AcademicYearRepositoryModule } from '../../academic-year/repositories/academic-year-repository.module';
import { TimetableRepositoryModule } from './repositories/timetable-repository.module';
import { TimetableResolver } from './timetable.resolver';
import { TimetableService } from './timetable.service';
import { TimetableGenerationService } from './timetable-generation.service';
import { TimetablePdfService } from './timetable-pdf.service';
import { TimetableScheduleService } from './timetable-schedule.service';
import { TimetableViewResolver } from './timetable-view.resolver';
import { TimetableViewService } from './timetable-view.service';

@Module({
  imports: [TimetableRepositoryModule, AcademicYearRepositoryModule],
  providers: [
    TimetableService,
    TimetableGenerationService,
    TimetableScheduleService,
    TimetableViewService,
    TimetablePdfService,
    TimetableResolver,
    TimetableViewResolver,
  ],
  exports: [TimetableService, TimetableScheduleService, TimetableViewService],
})
export class TimetableModule {}
