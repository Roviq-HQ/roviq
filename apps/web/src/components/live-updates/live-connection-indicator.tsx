'use client';

import { type LiveConnectionStatus, useLiveConnection } from '@roviq/graphql';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Radio, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

const { liveUpdates: ids } = testIds;

const LOOK: Record<
  Exclude<LiveConnectionStatus, 'idle'>,
  { label: string; dot: string; Icon: typeof Radio }
> = {
  connected: { label: 'connected', dot: 'bg-success', Icon: Radio },
  connecting: { label: 'connecting', dot: 'bg-warning', Icon: RefreshCw },
  reconnecting: { label: 'reconnecting', dot: 'bg-warning', Icon: RefreshCw },
  stopped: { label: 'stopped', dot: 'bg-destructive', Icon: WifiOff },
  offline: { label: 'offline', dot: 'bg-destructive', Icon: WifiOff },
  'session-ended': { label: 'sessionEnded', dot: 'bg-destructive', Icon: WifiOff },
  'impersonation-ended': { label: 'impersonationEnded', dot: 'bg-destructive', Icon: WifiOff },
};

/**
 * Top-bar dot for the live-updates socket: an icon, a coloured dot and a label (tooltip on
 * hover, focus and tap). The slot keeps its size on pages with no live data, so the bar never
 * shifts.
 */
export function LiveConnectionIndicator() {
  const t = useTranslations('liveUpdates.indicator');
  const { status } = useLiveConnection();
  if (status === 'idle') return <span className="inline-block size-9" aria-hidden="true" />;

  const { label, dot, Icon } = LOOK[status];
  const text = t(label);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={text}
          data-testid={ids.indicator}
          data-status={status}
        >
          <span className="relative inline-flex">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span
              className={`absolute -end-1 -top-1 size-2 rounded-full ${dot}`}
              aria-hidden="true"
            />
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
