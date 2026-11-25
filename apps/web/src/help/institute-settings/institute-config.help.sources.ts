export const instituteConfigHelpSources = {
  attendanceType: [
    'apps/api-gateway/src/institute/attendance/attendance.service.ts',
    'apps/web/src/app/[locale]/admin/(dashboard)/institutes/_components/config-display.tsx',
  ],
  shifts: [
    'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts',
    'apps/web/src/app/[locale]/admin/(dashboard)/institutes/_components/config-display.tsx',
  ],
  gradingSystem: [
    'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts',
  ],
  optimalStrength: [
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.enroll',
  ],
  hardMax: [
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.checkCapacity',
    'apps/api-gateway/src/institute/academic-year/academic-year.service.ts#AcademicYearService.previewRollover',
  ],
  exemptionAllowed: [
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.checkCapacity',
  ],
} as const;
