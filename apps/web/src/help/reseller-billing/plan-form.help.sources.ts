import type { HelpSources } from '@roviq/ui';
import type { planFormHelp } from './plan-form.help';

const FORM = 'apps/web/src/app/[locale]/reseller/(dashboard)/billing/plans/plan-form-dialog.tsx';

export const planFormHelpSources = {
  code: [FORM],
  amount: [FORM],
  interval: [FORM],
  trialDays: [
    FORM,
    'ee/apps/api-gateway/src/billing/reseller/subscription.service.ts#SubscriptionService.assignPlan',
  ],
  limits: [
    FORM,
    'apps/api-gateway/src/files/file.service.ts#FileService.assertWithinQuota',
    'libs/backend/entitlements/src/entitlement.service.ts#EntitlementService.checkLimit',
  ],
} satisfies HelpSources<typeof planFormHelp>;
