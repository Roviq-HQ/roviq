import type { HelpSources } from '@roviq/ui';
import type { planFormHelp } from './plan-form.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/billing/plans/plan-form-dialog.tsx';

export const planFormHelpSources = {
  code: [FORM],
  amount: [FORM],
  interval: [FORM],
  trialDays: [FORM],
  limits: [FORM],
} satisfies HelpSources<typeof planFormHelp>;
