import type { HelpSources } from '@roviq/ui';
import type { instituteGroupNewHelp } from './institute-group-new.help';

const FORM = 'apps/web/src/app/[locale]/admin/(dashboard)/institute-groups/new/page.tsx';

export const instituteGroupNewHelpSources = {
  code: [FORM],
  type: [FORM, 'libs/shared/common-types/src/lib/enums/institute-group.ts'],
  registrationNumber: [FORM],
  registrationState: [FORM],
} satisfies HelpSources<typeof instituteGroupNewHelp>;
