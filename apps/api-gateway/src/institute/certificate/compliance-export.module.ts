import { Module } from '@nestjs/common';
import { TemporalClientModule } from '@roviq/temporal';
import { FilesModule } from '../../files/files.module';
import { ComplianceExportService } from './compliance-export.service';
import { ExportReportFileResolver } from './export-report-file.resolver';
import { ExportReportDrizzleRepository } from './repositories/export-report.drizzle-repository';
import { ExportReportRepository } from './repositories/export-report.repository';
import { ComplianceExportWorkerService } from './workflows/compliance-export.worker';

/** Compliance exports for both portals: the service, its repository, the worker and the file field. */
@Module({
  imports: [FilesModule, TemporalClientModule],
  providers: [
    { provide: ExportReportRepository, useClass: ExportReportDrizzleRepository },
    ComplianceExportService,
    ExportReportFileResolver,
    ComplianceExportWorkerService,
  ],
  exports: [ComplianceExportService],
})
export class ComplianceExportModule {}
