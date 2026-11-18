'use client';

import { useFormatDate } from '@roviq/i18n';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useSystemHealth } from '../_lib/use-system-health';
import { AlertsPanel } from './alerts-panel';
import { ConnectionsPanel } from './connections-panel';
import { DlqBanner } from './dlq-banner';
import { NatsLagPanel } from './nats-lag-panel';
import { ObservabilityLinkCard } from './observability-link-card';
import { SectionError } from './section-error';
import { ServiceStatusGrid } from './service-status-grid';
import { TenantAnalyticsTable } from './tenant-analytics-table';

const { adminMonitoring: ids } = testIds;

export function MonitoringDashboard() {
  const t = useTranslations('adminMonitoring');
  const { health, lagHistory, error, refetch } = useSystemHealth();

  return (
    <div className="flex flex-col gap-4" data-testid={ids.page}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid={ids.title}>
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        {health ? <LiveIndicator checkedAt={health.checkedAt} /> : null}
      </div>

      {error && !health ? (
        <SectionError
          error={error}
          onRetry={() => void refetch()}
          testId={ids.healthError}
          retryTestId={ids.healthRetryBtn}
        />
      ) : (
        <>
          <DlqBanner count={health?.dlqPendingCount ?? 0} />
          <ServiceStatusGrid services={health?.services} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AlertsPanel health={health} />
            <NatsLagPanel streams={health?.natsStreams} history={lagHistory} />
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConnectionsPanel />
        </div>
        <ObservabilityLinkCard />
      </div>

      <TenantAnalyticsTable />
    </div>
  );
}

function LiveIndicator({ checkedAt }: { checkedAt: string }) {
  const t = useTranslations('adminMonitoring.live');
  const { formatDistance } = useFormatDate();
  // Re-render so the relative time keeps moving between pushes.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const checked = new Date(checkedAt);
  return (
    <p
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      aria-live="polite"
      data-testid={ids.liveIndicator}
    >
      <Radio className="size-3.5 text-emerald-600" aria-hidden="true" />
      <span className="font-medium text-foreground">{t('connected')}</span>
      <span>·</span>
      <time dateTime={checkedAt}>
        {t('lastUpdated', { time: formatDistance(checked, Math.max(now, checked.getTime())) })}
      </time>
    </p>
  );
}
