import type { HelpSources } from '@roviq/ui';
import type { resellerInstituteNewHelp } from './reseller-institute-new.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/institutes/new/page.tsx';
const INPUT =
  'apps/api-gateway/src/reseller/institute/dto/reseller-create-institute-request.input.ts';

export const resellerInstituteNewHelpSources = {
  group: [FORM, INPUT],
} satisfies HelpSources<typeof resellerInstituteNewHelp>;
