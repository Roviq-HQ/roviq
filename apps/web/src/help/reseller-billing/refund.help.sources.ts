import type { HelpSources } from '@roviq/ui';
import type { refundHelp } from './refund.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/billing/invoices/refund-dialog.tsx';

export const refundHelpSources = {
  amount: [FORM],
  reason: [FORM],
} satisfies HelpSources<typeof refundHelp>;
