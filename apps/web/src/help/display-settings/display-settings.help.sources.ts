import type { HelpSources } from '@roviq/ui';
import type { displaySettingsHelp } from './display-settings.help';

export const displaySettingsHelpSources = {
  sampleAdmissionNumber: [
    'apps/api-gateway/src/institute/student/repositories/admit-student.ts#admitStudent',
    'apps/api-gateway/src/institute/student/admission-number.sequence.ts#nextAdmissionNumber',
  ],
} satisfies HelpSources<typeof displaySettingsHelp>;
