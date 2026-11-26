import type { HelpSources } from '@roviq/ui';
import type { instituteNewHelp } from './institute-new.help';

const ADMIN_FORM = 'apps/web/src/app/[locale]/admin/(dashboard)/institutes/new/page.tsx';
const RESELLER_FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/institutes/new/page.tsx';
const ADMIN_INPUT = 'apps/api-gateway/src/admin/institute/dto/admin-create-institute.input.ts';
const RESELLER_INPUT =
  'apps/api-gateway/src/reseller/institute/dto/reseller-create-institute-request.input.ts';
const INSTITUTES = 'libs/database/src/schema/tenant/institutes.ts';
const ENUMS = 'libs/shared/common-types/src/lib/enums/institute.ts';

export const instituteNewHelpSources = {
  code: [ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT, INSTITUTES],
  type: [
    ENUMS,
    ADMIN_FORM,
    RESELLER_FORM,
    ADMIN_INPUT,
    RESELLER_INPUT,
    INSTITUTES,
    'apps/api-gateway/src/institute/management/seed/institute-setup.service.ts#InstituteSetupService.seedAcademicStructure',
    'apps/api-gateway/src/institute/academic-year/academic-year.service.ts',
  ],
  structureFramework: [ENUMS, ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT],
  board: [
    ADMIN_FORM,
    RESELLER_FORM,
    ADMIN_INPUT,
    RESELLER_INPUT,
    'apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts',
    'apps/api-gateway/src/institute/certificate/exports/bseh-staff-statement.export.ts',
    'apps/api-gateway/src/institute/management/seed/institute-setup.service.ts#InstituteSetupService.seedAcademicStructure',
  ],
  firstAdmin: [ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT],
} satisfies HelpSources<typeof instituteNewHelp>;
