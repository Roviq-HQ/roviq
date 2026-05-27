'use client';

import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';

const { adminAuditLogs } = testIds;

/** Impersonator scopes a session can originate from. Matches the backend IMPERSONATOR_SCOPES. */
export const IMPERSONATOR_SCOPES = ['platform', 'reseller', 'institute'] as const;
export type ImpersonatorScope = (typeof IMPERSONATOR_SCOPES)[number];

/** nuqs-backed multi-select for the impersonator scope. Shared between the page and the filter. */
export function useImpersonatorScopeFilter() {
  return useQueryState('impScope', parseAsArrayOf(parseAsString).withDefault([]));
}

/**
 * Multi-select toggle group for filtering impersonated audit entries by the impersonator's
 * originating scope. Rendered only on the impersonation tab.
 */
export function ImpersonationScopeFilter() {
  const t = useTranslations('auditLogs');
  const [scopes, setScopes] = useImpersonatorScopeFilter();

  const toggle = (scope: ImpersonatorScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <fieldset
      className="flex flex-wrap items-center gap-2 border-0 p-0"
      data-testid={adminAuditLogs.scopeFilter}
    >
      <legend className="me-1 text-sm text-muted-foreground">
        {t('filters.impersonatorScope')}:
      </legend>
      {IMPERSONATOR_SCOPES.map((scope) => {
        const active = scopes.includes(scope);
        return (
          <Button
            key={scope}
            type="button"
            size="sm"
            variant={active ? 'default' : 'outline'}
            aria-pressed={active}
            onClick={() => toggle(scope)}
            data-testid={adminAuditLogs.scopeFilterOption(scope)}
          >
            {t(`scopes.${scope}`)}
          </Button>
        );
      })}
    </fieldset>
  );
}
