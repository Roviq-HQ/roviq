'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Sparkline } from '@web/components/metrics/sparkline';
import { useTranslations } from 'next-intl';
import { type LagSample, lagSeries } from '../_lib/health-state';
import type { SystemHealthFieldsFragment } from '../_lib/system-health.graphql.generated';

const { adminMonitoring: ids } = testIds;

interface NatsLagPanelProps {
  streams: SystemHealthFieldsFragment['natsStreams'] | undefined;
  history: readonly LagSample[];
}

export function NatsLagPanel({ streams, history }: NatsLagPanelProps) {
  const t = useTranslations('adminMonitoring.nats');

  return (
    <Card id="event-streams" className="scroll-mt-20" data-testid={ids.natsPanel}>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!streams ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : streams.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid={ids.natsEmpty}>
            {t('empty')}
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col divide-y overflow-y-auto pe-1">
            {[...streams].sort(byLagDesc).map((s) => {
              const series = lagSeries(history, s.name);
              return (
                <li
                  key={s.name}
                  className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                  data-testid={ids.natsStream(s.name)}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{s.name}</span>
                  <Sparkline
                    data={series.length > 1 ? series : null}
                    emptyText=""
                    label={t('chartLabel', { stream: s.name, values: series.join(', ') })}
                    color={s.consumerLag > 0 ? 'var(--color-destructive)' : undefined}
                  />
                  <span
                    className={
                      s.consumerLag > 0
                        ? 'w-24 text-end text-sm font-semibold tabular-nums text-destructive'
                        : 'w-24 text-end text-sm tabular-nums text-muted-foreground'
                    }
                  >
                    {t('pending', { count: s.consumerLag })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {history.length > 1 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('historyHint', { count: history.length })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Backlogged streams first so a problem is visible without scrolling.
function byLagDesc(
  a: SystemHealthFieldsFragment['natsStreams'][number],
  b: SystemHealthFieldsFragment['natsStreams'][number],
): number {
  return b.consumerLag - a.consumerLag || a.name.localeCompare(b.name);
}
