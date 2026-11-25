import type { HelpSources } from '@roviq/ui';
import type { resellerBrandingHelp } from './branding.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/settings/branding/page.tsx';

export const resellerBrandingHelpSources = {
  primaryColor: [FORM],
  customCss: [FORM],
} satisfies HelpSources<typeof resellerBrandingHelp>;
