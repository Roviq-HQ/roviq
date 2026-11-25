export const studentNewHelpSources = {
  socialCategory: [
    'apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts#TC_FIELDS',
    'apps/api-gateway/src/institute/certificate/exports/udise-dcf.export.ts',
    'apps/api-gateway/src/institute/certificate/exports/shala-darpan.export.ts',
    'apps/api-gateway/src/institute/certificate/exports/awr.export.ts',
  ],
  academicYear: [
    'apps/web/src/app/[locale]/institute/(dashboard)/people/students/new/page.tsx#StudentForm',
  ],
  admissionType: [
    'apps/api-gateway/src/institute/student/student.service.ts#StudentService.create',
    'apps/api-gateway/src/institute/certificate/exports/awr.export.ts',
    'libs/shared/common-types/src/lib/enums/user-profile.ts#ADMISSION_TYPE_VALUES',
  ],
} as const;
