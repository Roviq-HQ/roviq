import type { HelpSources } from '@roviq/ui';
import type { convertEnquiryHelp } from './convert-enquiry.help';

export const convertEnquiryHelpSources = {
  academicYear: [
    'apps/api-gateway/src/institute/admission/admission.service.ts#AdmissionService.convertEnquiryToApplication',
  ],
} satisfies HelpSources<typeof convertEnquiryHelp>;
