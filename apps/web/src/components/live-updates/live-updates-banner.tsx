'use client';

import { MANUAL_RECONNECT_AFTER, useLiveConnection } from '@roviq/graphql';
import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

const { liveUpdates: ids } = testIds;

/**
 * Says when the page has stopped receiving live changes, and why. Shown only while that is so;
 * a manual Reconnect appears once automatic retries keep failing, or after the session ended.
 */
export function LiveUpdatesBanner() {
  const t = useTranslations('liveUpdates');
  const { status, failedAttempts, reconnectNow } = useLiveConnection();

  if (status !== 'reconnecting' && status !== 'offline' && status !== 'session-ended') return null;

  const Icon = status === 'offline' ? WifiOff : status === 'session-ended' ? CloudOff : RefreshCw;
  const key =
    status === 'offline' ? 'offline' : status === 'session-ended' ? 'sessionEnded' : 'reconnecting';
  const offerReconnect =
    status === 'session-ended' ||
    (status === 'reconnecting' && failedAttempts >= MANUAL_RECONNECT_AFTER);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={ids.banner}
      data-status={status}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <Icon
        className={status === 'reconnecting' ? 'size-4 shrink-0 animate-spin' : 'size-4 shrink-0'}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t(`${key}.title`)}</span> {t(`${key}.description`)}
        {status === 'reconnecting' && offerReconnect && (
          <> {t('reconnecting.stillFailing', { count: failedAttempts })}</>
        )}
      </p>
      {offerReconnect && (
        <Button
          size="sm"
          variant="outline"
          onClick={reconnectNow}
          title={t('reconnectTitle')}
          data-testid={ids.reconnectBtn}
        >
          {t('reconnect')}
        </Button>
      )}
    </div>
  );
}
