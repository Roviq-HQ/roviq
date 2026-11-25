import type { HelpSources } from '@roviq/ui';
import type { recordPaymentHelp } from './record-payment.help';

const FORM =
  'apps/web/src/app/[locale]/reseller/(dashboard)/billing/invoices/record-payment-dialog.tsx';

export const recordPaymentHelpSources = {
  method: [FORM],
  receiptNumber: [FORM],
  collectionDate: [FORM],
} satisfies HelpSources<typeof recordPaymentHelp>;
