import type { HelpSources } from '@roviq/ui';
import type { subscriptionActionsHelp } from './subscription-actions.help';

const ACTION =
  'apps/web/src/app/[locale]/reseller/(dashboard)/billing/subscriptions/subscription-action-dialog.tsx';
const CHANGE_PLAN =
  'apps/web/src/app/[locale]/reseller/(dashboard)/billing/subscriptions/change-plan-dialog.tsx';

export const subscriptionActionsHelpSources = {
  reason: [ACTION],
  proration: [CHANGE_PLAN],
} satisfies HelpSources<typeof subscriptionActionsHelp>;
