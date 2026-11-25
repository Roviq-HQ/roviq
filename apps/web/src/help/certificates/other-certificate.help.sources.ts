import type { HelpSources } from '@roviq/ui';
import type { otherCertificateHelp } from './other-certificate.help';

export const otherCertificateHelpSources = {
  template: [
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.getCertificateTemplateFields',
    'libs/database/src/schema/admission/certificate-templates.ts#certificateTemplates',
  ],
  purpose: [
    'apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts#DEFAULT_CERTIFICATE_BODY',
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.requestCertificate',
  ],
} satisfies HelpSources<typeof otherCertificateHelp>;
