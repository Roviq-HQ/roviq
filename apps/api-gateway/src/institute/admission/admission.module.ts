import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AdmissionService } from './admission.service';
import { AdmissionQueryService } from './admission-query.service';
import { AdmissionReadRepository } from './admission-read.repository';
import { ApplicationResolver } from './application.resolver';
import { EnquiryResolver } from './enquiry.resolver';
import { StudentAdmissionWorkerService } from './workflows/student-admission.worker';

@Module({
  imports: [AuthModule],
  providers: [
    AdmissionService,
    AdmissionQueryService,
    AdmissionReadRepository,
    EnquiryResolver,
    ApplicationResolver,
    StudentAdmissionWorkerService,
  ],
  exports: [AdmissionService],
})
export class AdmissionModule {}
