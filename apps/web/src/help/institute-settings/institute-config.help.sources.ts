import type { HelpSources } from '@roviq/ui';
import type { instituteConfigHelp } from './institute-config.help';

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
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.warnIfOptimalReached',
    'apps/notification-service/src/listeners/section.listener.ts#SectionListener.handleCapacityWarning',
    'apps/notification-service/src/repositories/recipient-read.drizzle-repository.ts#RecipientReadDrizzleRepository.findSectionCapacityAudience',
  ],
  hardMax: [
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.checkCapacity',
    'apps/api-gateway/src/institute/academic-year/academic-year.service.ts#AcademicYearService.previewRollover',
  ],
  exemptionAllowed: [
    'apps/api-gateway/src/institute/student/student-academic.service.ts#StudentAcademicService.checkCapacity',
  ],
} satisfies HelpSources<typeof instituteConfigHelp>;
