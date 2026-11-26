'use client';

import { type LiveConnectionStatus, useLiveConnection } from '@roviq/graphql';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Radio, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

const { liveUpdates: ids } = testIds;

const LOOK: Record<
  Exclude<LiveConnectionStatus, 'idle'>,
  { label: string; dot: string; Icon: typeof Radio }
> = {
  connected: { label: 'connected', dot: 'bg-emerald-500', Icon: Radio },
  connecting: { label: 'connecting', dot: 'bg-amber-400', Icon: RefreshCw },
  reconnecting: { label: 'reconnecting', dot: 'bg-amber-400', Icon: RefreshCw },
  offline: { label: 'offline', dot: 'bg-red-500', Icon: WifiOff },
  'session-ended': { label: 'sessionEnded', dot: 'bg-red-500', Icon: WifiOff },
};

/** Top-bar dot for the live-updates socket: green, amber or red, with an icon and a label. */
export function LiveConnectionIndicator() {
  const t = useTranslations('liveUpdates.indicator');
  const { status } = useLiveConnection();
  // No live data on this page: nothing to report.
  if (status === 'idle') return null;

  const { label, dot, Icon } = LOOK[status];
  const text = t(label);
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-testid={ids.indicator}
      data-status={status}
      className="inline-flex size-9 items-center justify-center"
    >
      <span className="relative inline-flex">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className={`absolute -end-1 -top-1 size-2 rounded-full ${dot}`} aria-hidden="true" />
      </span>
    </span>
  );
}
