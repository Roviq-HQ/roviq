import { Module } from '@nestjs/common';
import { CertificateResolver } from './certificate.resolver';
import { CertificateService } from './certificate.service';
import { ComplianceExportModule } from './compliance-export.module';
import { ComplianceExportResolver } from './compliance-export.resolver';
import { TCResolver } from './tc.resolver';
import { TCIssuanceWorkerService } from './workflows/tc-issuance.worker';

@Module({
  imports: [ComplianceExportModule],
  providers: [
    CertificateService,
    TCResolver,
    CertificateResolver,
    ComplianceExportResolver,
    TCIssuanceWorkerService,
  ],
  exports: [CertificateService],
})
export class CertificateModule {}
