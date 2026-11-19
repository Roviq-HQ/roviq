'use client';

import { Button, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

const { resellerSettings } = testIds;

export function SettingsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" data-testid={resellerSettings.loading}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function SettingsLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('resellerSettings');
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4"
      data-testid={resellerSettings.loadError}
    >
      <p className="text-sm">{t('loadError')}</p>
      <Button variant="outline" onClick={onRetry} data-testid={resellerSettings.retryBtn}>
        {t('retry')}
      </Button>
    </div>
  );
}

export function ReadOnlyNotice() {
  const t = useTranslations('resellerSettings');
  return (
    <p
      className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
      data-testid={resellerSettings.readOnlyNotice}
    >
      {t('readOnly')}
    </p>
  );
}

/** Asks before a refresh or tab close discards an edited form. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
