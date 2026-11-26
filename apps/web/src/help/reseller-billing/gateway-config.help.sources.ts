import type { HelpSources } from '@roviq/ui';
import type { gatewayConfigHelp } from './gateway-config.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/billing/gateway-configs/page.tsx';

export const gatewayConfigHelpSources = {
  vpa: [FORM],
  keyId: [FORM],
  keySecret: [FORM],
  webhookSecret: [FORM],
  testMode: [
    FORM,
    'ee/apps/api-gateway/src/billing/reseller/gateway-config.service.ts#GatewayConfigService.createConfig',
    'ee/apps/api-gateway/src/billing/reseller/gateway-config.service.ts#GatewayConfigService.updateConfig',
  ],
  defaultGateway: [
    FORM,
    'ee/apps/api-gateway/src/billing/repositories/gateway-config.repository.ts#GatewayConfigRepository.clearDefault',
    'ee/libs/backend/payments/src/repositories/payment-gateway-config.drizzle-repository.ts#PaymentGatewayConfigDrizzleRepository.findByInstituteId',
  ],
} satisfies HelpSources<typeof gatewayConfigHelp>;
