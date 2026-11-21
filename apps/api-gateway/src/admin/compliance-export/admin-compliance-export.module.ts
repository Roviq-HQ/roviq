import { Module } from '@nestjs/common';
import { ComplianceExportModule } from '../../institute/certificate/compliance-export.module';
import { AdminComplianceExportResolver } from './admin-compliance-export.resolver';

@Module({
  imports: [ComplianceExportModule],
  providers: [AdminComplianceExportResolver],
})
export class AdminComplianceExportModule {}
