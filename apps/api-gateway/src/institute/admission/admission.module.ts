import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FilesModule } from '../../files/files.module';
import { AdmissionService } from './admission.service';
import { AdmissionQueryService } from './admission-query.service';
import { AdmissionReadRepository } from './admission-read.repository';
import { ApplicationResolver } from './application.resolver';
import { ApplicationDocumentRepository } from './application-document.repository';
import { ApplicationDocumentResolver } from './application-document.resolver';
import { ApplicationDocumentService } from './application-document.service';
import { ApplicationFieldResolver } from './application-field.resolver';
import { EnquiryResolver } from './enquiry.resolver';
import { AdmissionRepositoryModule } from './repositories/admission-repository.module';
import { StandardNameLoaders } from './standard-name.loaders';
import { StudentAdmissionWorkerService } from './workflows/student-admission.worker';

@Module({
  imports: [AuthModule, FilesModule, AdmissionRepositoryModule],
  providers: [
    AdmissionService,
    AdmissionQueryService,
    AdmissionReadRepository,
    EnquiryResolver,
    ApplicationResolver,
    ApplicationFieldResolver,
    StandardNameLoaders,
    ApplicationDocumentRepository,
    ApplicationDocumentService,
    ApplicationDocumentResolver,
    StudentAdmissionWorkerService,
  ],
  exports: [AdmissionService],
})
export class AdmissionModule {}
