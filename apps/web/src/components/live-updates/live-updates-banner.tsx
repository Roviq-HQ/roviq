'use client';

import {
  type LiveConnectionStatus,
  MANUAL_RECONNECT_AFTER,
  useLiveConnection,
} from '@roviq/graphql';
import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const { liveUpdates: ids } = testIds;

/** A short drop is common on mobile data; "reconnecting" shows only if it lasts this long. */
export const RECONNECTING_BANNER_DELAY_MS = 2_000;

type Shown = Exclude<LiveConnectionStatus, 'idle' | 'connecting' | 'connected'>;

const COPY: Record<Shown, { key: string; Icon: typeof WifiOff; spin?: boolean }> = {
  reconnecting: { key: 'reconnecting', Icon: RefreshCw, spin: true },
  stopped: { key: 'stopped', Icon: CloudOff },
  offline: { key: 'offline', Icon: WifiOff },
  'session-ended': { key: 'sessionEnded', Icon: CloudOff },
  'impersonation-ended': { key: 'impersonationEnded', Icon: CloudOff },
};

/**
 * Says when the page has stopped receiving live changes, and why. It floats over the page, so
 * showing and hiding it moves nothing; a polite live region announces each change once.
 */
export function LiveUpdatesBanner() {
  const t = useTranslations('liveUpdates');
  const { status, failedAttempts, reconnectNow } = useLiveConnection();
  const shown = useShownStatus(status);
  const announcement = useAnnouncement(shown);

  const copy = shown ? COPY[shown] : null;
  const offerReconnect =
    shown === 'stopped' ||
    shown === 'session-ended' ||
    (shown === 'reconnecting' && failedAttempts >= MANUAL_RECONNECT_AFTER);

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement ? t(`announce.${announcement}`) : ''}
      </div>
      {copy && shown && (
        <div
          data-testid={ids.banner}
          data-status={shown}
          className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-background px-4 py-3 text-sm shadow-lg md:bottom-4 print:hidden"
        >
          <copy.Icon
            className={
              copy.spin
                ? 'size-4 shrink-0 animate-spin text-warning'
                : 'size-4 shrink-0 text-warning'
            }
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{t(`${copy.key}.title`)}</span>{' '}
            {t(`${copy.key}.description`)}
            {shown === 'reconnecting' && offerReconnect && (
              <>
                {' '}
                {t('reconnecting.stillFailing')}{' '}
                <span className="text-muted-foreground">
                  {t('reconnecting.attempts', { count: failedAttempts })}
                </span>
              </>
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
      )}
    </>
  );
}

/** The status to show, or null: "reconnecting" waits out a short drop before it appears. */
function useShownStatus(status: LiveConnectionStatus): Shown | null {
  const [reconnectingLongEnough, setReconnectingLongEnough] = React.useState(false);
  React.useEffect(() => {
    if (status !== 'reconnecting') {
      setReconnectingLongEnough(false);
      return;
    }
    const timer = setTimeout(() => setReconnectingLongEnough(true), RECONNECTING_BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'reconnecting') return reconnectingLongEnough ? 'reconnecting' : null;
  if (status === 'idle' || status === 'connecting' || status === 'connected') return null;
  return status;
}

/** One line per change of state; "back" once after a problem, then quiet. */
function useAnnouncement(shown: Shown | null): string | null {
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const previous = React.useRef<Shown | null>(null);
  React.useEffect(() => {
    if (shown === previous.current) return;
    if (shown) setAnnouncement(COPY[shown].key);
    else if (previous.current) setAnnouncement('restored');
    previous.current = shown;
  }, [shown]);
  return announcement;
}
