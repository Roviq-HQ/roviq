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
  type: [ENUMS, ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT, INSTITUTES],
  structureFramework: [ENUMS, ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT],
  board: [ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT],
  firstAdmin: [ADMIN_FORM, RESELLER_FORM, ADMIN_INPUT, RESELLER_INPUT],
} satisfies HelpSources<typeof instituteNewHelp>;
