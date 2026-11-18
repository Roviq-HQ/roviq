'use client';

import type { AuditDiffRendererLabels, ImpersonationBadgeLabels } from '@roviq/ui';
import { useTranslations } from 'next-intl';
import * as React from 'react';

/** Translated `labels` for the shared `AuditDiffRenderer` and `ImpersonationBadge`. */
export function useAuditLabels(): {
  diff: AuditDiffRendererLabels;
  impersonation: ImpersonationBadgeLabels;
} {
  const t = useTranslations('auditLogs');

  return React.useMemo(
    () => ({
      diff: {
        noChanges: t('detail.noChanges'),
        fieldsDeleted: (count) => t('diff.fieldsDeleted', { count }),
        deletedSnapshot: t('diff.deletedSnapshot'),
        fieldHeader: t('diff.field'),
        oldValueHeader: t('diff.oldValue'),
        newValueHeader: t('diff.newValue'),
      },
      impersonation: {
        badgeText: (name) => t('impersonation.badge', { name }),
        tooltipText: (name, scope, userName) =>
          userName
            ? t('impersonation.tooltipWithUser', { name, scope, userName })
            : t('impersonation.tooltip', { name, scope }),
        scopeLabels: {
          platform: t('impersonation.scopeLabels.platform'),
          reseller: t('impersonation.scopeLabels.reseller'),
          institute: t('impersonation.scopeLabels.institute'),
        },
      },
    }),
    [t],
  );
}
