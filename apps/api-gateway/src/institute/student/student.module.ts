import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FilesModule } from '../../files/files.module';
import { StudentResolver } from './student.resolver';
import { StudentService } from './student.service';
import { StudentAcademicResolver } from './student-academic.resolver';
import { StudentAcademicService } from './student-academic.service';
import {
  BulkImportReportResolver,
  StudentBulkImportResolver,
} from './student-bulk-import.resolver';
import { StudentBulkImportService } from './student-bulk-import.service';
import { StudentEventHandler } from './student-event.handler';
import { StudentQueryService } from './student-query.service';
import { StudentReadRepository } from './student-read.repository';
import { BulkStudentImportWorkerService } from './workflows/bulk-student-import.worker';

@Module({
  imports: [AuthModule, FilesModule],
  controllers: [StudentEventHandler],
  providers: [
    StudentService,
    StudentQueryService,
    StudentReadRepository,
    StudentResolver,
    StudentAcademicService,
    StudentAcademicResolver,
    StudentBulkImportService,
    StudentBulkImportResolver,
    BulkImportReportResolver,
    BulkStudentImportWorkerService,
  ],
  exports: [StudentService],
})
export class StudentModule {}
