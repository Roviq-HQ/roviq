import { Module } from '@nestjs/common';
import { DRIZZLE_DB, type DrizzleDB } from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { FilesModule } from '../../files/files.module';
import { WorkflowFileStore } from '../../files/workflow-file-store';
import { PdfModule } from '../../pdf/pdf.module';
import { CertificateResolver } from './certificate.resolver';
import { CertificateService } from './certificate.service';
import { CertificatePdfResolver, TcPdfResolver } from './certificate-pdf.resolver';
import { CertificatePdfService } from './certificate-pdf.service';
import { ComplianceExportModule } from './compliance-export.module';
import { ComplianceExportResolver } from './compliance-export.resolver';
import { CertificateDrizzleRepository } from './repositories/certificate.drizzle-repository';
import { CertificateRepository } from './repositories/certificate.repository';
import { TcDrizzleRepository } from './repositories/tc.drizzle-repository';
import { TcRepository } from './repositories/tc.repository';
import { TcVerificationRepository } from './repositories/tc-verification.repository';
import { TCResolver } from './tc.resolver';
import { TcVerificationResolver } from './tc-verification.resolver';
import { TCIssuanceWorkerService } from './workflows/tc-issuance.worker';

@Module({
  imports: [ComplianceExportModule, FilesModule, PdfModule],
  providers: [
    { provide: TcRepository, useClass: TcDrizzleRepository },
    { provide: CertificateRepository, useClass: CertificateDrizzleRepository },
    {
      provide: WorkflowFileStore,
      inject: [DRIZZLE_DB, StorageClient],
      useFactory: (db: DrizzleDB, storage: StorageClient) => new WorkflowFileStore(db, storage),
    },
    CertificatePdfService,
    CertificateService,
    TcPdfResolver,
    CertificatePdfResolver,
    TcVerificationRepository,
    TcVerificationResolver,
    TCResolver,
    CertificateResolver,
    ComplianceExportResolver,
    TCIssuanceWorkerService,
  ],
  exports: [CertificateService],
})
export class CertificateModule {}
