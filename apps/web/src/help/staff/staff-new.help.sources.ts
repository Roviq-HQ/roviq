import type { HelpSources } from '@roviq/ui';
import type { staffNewHelp } from './staff-new.help';

const FORM = 'apps/web/src/app/[locale]/institute/(dashboard)/people/staff/new/page.tsx';
const EXPORTS = 'apps/api-gateway/src/institute/certificate/exports';
const STAFF = 'apps/api-gateway/src/institute/staff';
const PROFILES = 'libs/database/src/schema/user-profiles/staff-profiles.ts';
const ENUMS = 'libs/shared/common-types/src/lib/enums/user-profile.ts';

export const staffNewHelpSources = {
  socialCategory: [
    `${ENUMS}#SOCIAL_CATEGORY_VALUES`,
    `${FORM}#buildSchema.socialCategory`,
    `${STAFF}/dto/create-staff.input.ts#CreateStaffInput.socialCategory`,
    `${STAFF}/repositories/staff.drizzle-repository.ts#StaffDrizzleRepository.create`,
    `${EXPORTS}/export-helpers.ts#socialCategoryLabel`,
    `${EXPORTS}/bseh-staff-statement.export.ts#buildBsehStaffStatement`,
    `${EXPORTS}/shala-darpan.export.ts#buildShalaDarpanExport`,
  ],
  employeeId: [
    `${FORM}#buildSchema.employeeId`,
    `${STAFF}/staff.service.ts#StaffService.create`,
    `${STAFF}/repositories/staff.drizzle-repository.ts#insertWithSeriesId`,
    `${STAFF}/repositories/staff.drizzle-repository.ts#StaffDrizzleRepository.isEmployeeIdTaken`,
    `${STAFF}/dto/create-staff.input.ts#CreateStaffInput.employeeId`,
    'libs/database/migrations/20261125103827_staff-employee-id-unique/migration.sql',
    `${PROFILES}#staffProfiles.employeeId`,
    `${EXPORTS}/bseh-staff-statement.export.ts#buildBsehStaffStatement`,
    `${EXPORTS}/shala-darpan.export.ts#buildShalaDarpanExport`,
  ],
  designation: [
    `${FORM}#buildSchema.designation`,
    `${STAFF}/dto/create-staff.input.ts#CreateStaffInput.designation`,
    `${STAFF}/repositories/staff.drizzle-repository.ts#StaffDrizzleRepository.list`,
    `${PROFILES}#staffProfiles.designation`,
    `${EXPORTS}/bseh-staff-statement.export.ts#buildBsehStaffStatement`,
  ],
  department: [
    `${FORM}#buildSchema.department`,
    `${STAFF}/dto/create-staff.input.ts#CreateStaffInput.department`,
    `${PROFILES}#staffProfiles.department`,
    `${EXPORTS}/bseh-staff-statement.export.ts#buildBsehStaffStatement`,
  ],
  employmentType: [
    `${ENUMS}#EMPLOYMENT_TYPE_VALUES`,
    `${FORM}#buildSchema.employmentType`,
    `${STAFF}/staff.service.ts#StaffService.create`,
    `${PROFILES}#staffProfiles.employmentType`,
    `${EXPORTS}/export-helpers.ts#natureOfAppointment`,
    `${EXPORTS}/export-helpers.ts#employmentTypeLabel`,
    `${EXPORTS}/bseh-staff-statement.export.ts#buildBsehStaffStatement`,
  ],
} satisfies HelpSources<typeof staffNewHelp>;
