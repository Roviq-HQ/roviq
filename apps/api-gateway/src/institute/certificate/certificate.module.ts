import { Module } from '@nestjs/common';
import { CertificateResolver } from './certificate.resolver';
import { CertificateService } from './certificate.service';
import { ComplianceExportModule } from './compliance-export.module';
import { ComplianceExportResolver } from './compliance-export.resolver';
import { CertificateDrizzleRepository } from './repositories/certificate.drizzle-repository';
import { CertificateRepository } from './repositories/certificate.repository';
import { TcDrizzleRepository } from './repositories/tc.drizzle-repository';
import { TcRepository } from './repositories/tc.repository';
import { TCResolver } from './tc.resolver';
import { TCIssuanceWorkerService } from './workflows/tc-issuance.worker';

@Module({
  imports: [ComplianceExportModule],
  providers: [
    { provide: TcRepository, useClass: TcDrizzleRepository },
    { provide: CertificateRepository, useClass: CertificateDrizzleRepository },
    CertificateService,
    TCResolver,
    CertificateResolver,
    ComplianceExportResolver,
    TCIssuanceWorkerService,
  ],
  exports: [CertificateService],
})
export class CertificateModule {}
