'use client';

import { useQuery } from '@roviq/graphql';
import { useFormatNumber } from '@roviq/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { MetricCard } from '@web/components/metrics/metric-card';
import { Sparkline } from '@web/components/metrics/sparkline';
import { Globe, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { appendBounded, CONNECTION_HISTORY_SIZE } from '../_lib/health-state';
import { AdminConnectionMetricsDocument } from '../_lib/system-health.graphql.generated';
import { SectionError } from './section-error';

const { adminMonitoring: ids } = testIds;

export const CONNECTIONS_POLL_MS = 10_000;

interface ConnectionSample {
  websocket: number;
  http: number;
}

export function ConnectionsPanel() {
  const t = useTranslations('adminMonitoring.connections');
  const { format } = useFormatNumber();
  const { data, error, refetch } = useQuery(AdminConnectionMetricsDocument, {
    pollInterval: CONNECTIONS_POLL_MS,
    // Each poll must land in `data` even when the numbers repeat, to extend the trend.
    notifyOnNetworkStatusChange: true,
  });
  const [history, setHistory] = React.useState<ConnectionSample[]>([]);

  const current = data?.adminConnectionMetrics;
  React.useEffect(() => {
    if (!current) return;
    setHistory((h) =>
      appendBounded(
        h,
        { websocket: current.websocket, http: current.http },
        CONNECTION_HISTORY_SIZE,
      ),
    );
  }, [current]);

  const wsSeries = history.map((h) => h.websocket);
  const httpSeries = history.map((h) => h.http);

  return (
    <Card data-testid={ids.connectionsPanel}>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && !current ? (
          <SectionError
            error={error}
            onRetry={() => void refetch()}
            testId={ids.connectionsError}
            retryTestId={ids.healthRetryBtn}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard
              metricKey="websocket"
              title={t('websocket')}
              icon={Radio}
              value={current ? format(current.websocket) : '—'}
            >
              <Sparkline
                data={wsSeries.length > 1 ? wsSeries : null}
                emptyText=""
                width="100%"
                label={t('trendLabel', { label: t('websocket'), values: wsSeries.join(', ') })}
              />
            </MetricCard>
            <MetricCard
              metricKey="http"
              title={t('http')}
              icon={Globe}
              value={current ? format(current.http) : '—'}
            >
              <Sparkline
                data={httpSeries.length > 1 ? httpSeries : null}
                emptyText=""
                width="100%"
                label={t('trendLabel', { label: t('http'), values: httpSeries.join(', ') })}
              />
            </MetricCard>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
