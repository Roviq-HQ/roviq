import type { HelpSources } from '@roviq/ui';
import type { gatewayConfigHelp } from './gateway-config.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/billing/gateway-configs/page.tsx';

export const gatewayConfigHelpSources = {
  vpa: [FORM],
  keyId: [FORM],
  keySecret: [FORM],
  webhookSecret: [FORM],
  testMode: [FORM],
  defaultGateway: [FORM],
} satisfies HelpSources<typeof gatewayConfigHelp>;
