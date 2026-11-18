'use client';

import type { ServiceHealthStatus } from '@roviq/graphql/generated';
import { useFormatNumber } from '@roviq/i18n';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ServiceCard, type ServiceCardLabels } from '@web/components/metrics/service-card';
import { StatusGrid } from '@web/components/metrics/status-grid';
import type { HealthStatus } from '@web/components/metrics/types';
import { useTranslations } from 'next-intl';
import type { SystemHealthFieldsFragment } from '../_lib/system-health.graphql.generated';

const { adminMonitoring: ids } = testIds;

const STATUS: Record<ServiceHealthStatus, HealthStatus> = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DOWN: 'down',
};

interface ServiceStatusGridProps {
  services: SystemHealthFieldsFragment['services'] | undefined;
}

export function ServiceStatusGrid({ services }: ServiceStatusGridProps) {
  const t = useTranslations('adminMonitoring.services');
  const { format } = useFormatNumber();

  const labels: ServiceCardLabels = {
    status: {
      healthy: t('status.healthy'),
      degraded: t('status.degraded'),
      down: t('status.down'),
    },
    responseTime: t('responseTime'),
    uptime: t('uptime'),
    unknown: '—',
  };

  return (
    <section aria-labelledby="monitoring-services-heading" className="flex flex-col gap-2">
      <h2 id="monitoring-services-heading" className="text-lg font-semibold">
        {t('heading')}
      </h2>
      <StatusGrid loading={!services} loadingLabel={t('loading')} data-testid={ids.serviceGrid}>
        {services?.map((s) => (
          <ServiceCard
            key={s.name}
            serviceKey={s.name}
            name={t(`names.${s.name}`)}
            status={STATUS[s.status]}
            responseTime={
              s.responseMs === null
                ? null
                : t('responseMs', { value: format(s.responseMs, { maximumFractionDigits: 0 }) })
            }
            uptime={
              s.uptimePercent === null
                ? null
                : t('uptimePercent', {
                    value: format(s.uptimePercent, { maximumFractionDigits: 2 }),
                  })
            }
            labels={labels}
            data-testid={ids.serviceCard(s.name)}
          />
        ))}
      </StatusGrid>
    </section>
  );
}
