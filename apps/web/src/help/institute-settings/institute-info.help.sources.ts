import type { HelpSources } from '@roviq/ui';
import type { instituteInfoHelp } from './institute-info.help';

export const instituteInfoHelpSources = {
  identifiers: [
    'libs/shared/common-types/src/lib/compliance/export-eligibility.ts#eligibleComplianceReportTypes',
    'apps/api-gateway/src/institute/certificate/exports/shala-darpan.export.ts',
  ],
  affiliations: [
    'libs/shared/common-types/src/lib/compliance/export-eligibility.ts#eligibleComplianceReportTypes',
    'apps/api-gateway/src/institute/certificate/repositories/export-report.drizzle-repository.ts',
    'apps/api-gateway/src/institute/certificate/repositories/tc.drizzle-repository.ts#TcDrizzleRepository.findLetterhead',
  ],
} satisfies HelpSources<typeof instituteInfoHelp>;
