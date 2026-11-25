import type { HelpSources } from '@roviq/ui';
import type { guardianNewHelp } from './guardian-new.help';

export const guardianNewHelpSources = {
  educationLevel: [
    'libs/shared/common-types/src/lib/enums/user-profile.ts#GUARDIAN_EDUCATION_LEVEL_VALUES',
    'apps/api-gateway/src/institute/guardian/guardian-read.repository.ts',
  ],
} satisfies HelpSources<typeof guardianNewHelp>;
