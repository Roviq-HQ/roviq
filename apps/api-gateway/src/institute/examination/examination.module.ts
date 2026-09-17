import { Module } from '@nestjs/common';
import { ExaminationResolver } from './examination.resolver';
import { ExaminationService } from './examination.service';
import { ExaminationConfigService } from './examination-config.service';
import { ExaminationDatesheetPdfService } from './examination-datesheet-pdf.service';
import { ExaminationGradingService } from './examination-grading.service';
import { ExaminationMarksService } from './examination-marks.service';
import { ReportCardResolver } from './report-card.resolver';
import { ReportCardService } from './report-card.service';
import { ReportCardGenerationService } from './report-card-generation.service';
import { ReportCardPdfService } from './report-card-pdf.service';
import { ExaminationRepositoryModule } from './repositories/examination-repository.module';

@Module({
  imports: [ExaminationRepositoryModule],
  providers: [
    ExaminationGradingService,
    ExaminationConfigService,
    ExaminationService,
    ExaminationDatesheetPdfService,
    ExaminationMarksService,
    ReportCardGenerationService,
    ReportCardService,
    ReportCardPdfService,
    ExaminationResolver,
    ReportCardResolver,
  ],
  exports: [
    ExaminationService,
    ExaminationMarksService,
    ExaminationConfigService,
    ReportCardService,
  ],
})
export class ExaminationModule {}
