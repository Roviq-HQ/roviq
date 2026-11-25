import type { HelpSources } from '@roviq/ui';
import type { adminInstituteNewHelp } from './admin-institute-new.help';

const FORM = 'apps/web/src/app/[locale]/admin/(dashboard)/institutes/new/page.tsx';
const INPUT = 'apps/api-gateway/src/admin/institute/dto/admin-create-institute.input.ts';

export const adminInstituteNewHelpSources = {
  reseller: [FORM, INPUT],
  group: [FORM, INPUT, 'libs/database/src/schema/tenant/institute-groups.ts'],
} satisfies HelpSources<typeof adminInstituteNewHelp>;
