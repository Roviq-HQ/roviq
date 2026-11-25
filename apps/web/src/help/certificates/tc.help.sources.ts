export const tcHelpSources = {
  requestAcademicYear: [
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.requestTC',
    'apps/api-gateway/src/institute/certificate/exports/tc-register.export.ts',
    'apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts#TC_FIELDS',
  ],
  requestReason: [
    'apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts#TC_FIELDS',
    'apps/api-gateway/src/institute/certificate/exports/tc-register.export.ts#buildTcRegister',
  ],
  rejectReason: [
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.rejectTC',
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.requestTC',
  ],
  duplicateReason: [
    'apps/api-gateway/src/institute/certificate/certificate.service.ts#CertificateService.requestDuplicateTC',
    'apps/api-gateway/src/institute/certificate/repositories/tc.drizzle-repository.ts#TcDrizzleRepository.createDuplicateRequest',
    'apps/api-gateway/src/pdf/templates/tc.template.ts',
  ],
} as const;
