import type { HelpSources } from '@roviq/ui';
import type { subscriptionActionsHelp } from './subscription-actions.help';

const ACTION =
  'apps/web/src/app/[locale]/reseller/(dashboard)/billing/subscriptions/subscription-action-dialog.tsx';
const CHANGE_PLAN =
  'apps/web/src/app/[locale]/reseller/(dashboard)/billing/subscriptions/change-plan-dialog.tsx';

export const subscriptionActionsHelpSources = {
  reason: [
    ACTION,
    'ee/apps/api-gateway/src/billing/reseller/subscription.service.ts#SubscriptionService.pauseSubscription',
    'ee/apps/api-gateway/src/billing/reseller/subscription.service.ts#SubscriptionService.cancelSubscription',
  ],
  proration: [
    CHANGE_PLAN,
    'ee/apps/api-gateway/src/billing/reseller/subscription.service.ts#SubscriptionService.changePlan',
  ],
} satisfies HelpSources<typeof subscriptionActionsHelp>;
