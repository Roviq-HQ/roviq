import type { HelpSources } from '@roviq/ui';
import type { enquiryHelp } from './enquiry.help';

export const enquiryHelpSources = {
  source: [
    'libs/shared/common-types/src/lib/enums/admission.ts#ENQUIRY_SOURCE_VALUES',
    'apps/api-gateway/src/institute/admission/admission-read.repository.ts#AdmissionReadRepository.statistics',
  ],
  followUpDate: [
    'apps/api-gateway/src/institute/admission/admission-read.repository.ts#AdmissionReadRepository.listEnquiries',
    'apps/web/src/app/[locale]/institute/(dashboard)/admission/enquiries/page.tsx',
  ],
} satisfies HelpSources<typeof enquiryHelp>;
