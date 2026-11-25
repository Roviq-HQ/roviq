import type { HelpSources } from '@roviq/ui';
import type { instituteBrandingHelp } from './institute-branding.help';

export const instituteBrandingHelpSources = {
  primaryColor: [
    'apps/web/src/app/[locale]/institute/(dashboard)/tenant-theme-provider.tsx#applyTenantTheme',
  ],
  theme: [
    'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts',
    'apps/web/src/app/[locale]/admin/(dashboard)/institutes/_components/branding-display.tsx',
  ],
} satisfies HelpSources<typeof instituteBrandingHelp>;
