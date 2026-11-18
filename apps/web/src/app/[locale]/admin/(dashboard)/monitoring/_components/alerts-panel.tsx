'use client';

import type { AlertSeverity } from '@roviq/graphql/generated';
import { useFormatDate } from '@roviq/i18n';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SystemHealthFieldsFragment } from '../_lib/system-health.graphql.generated';

const { adminMonitoring: ids } = testIds;

const SEVERITY: Record<AlertSeverity, { icon: LucideIcon; className: string }> = {
  CRITICAL: { icon: AlertCircle, className: 'bg-destructive/10 text-destructive' },
  WARNING: {
    icon: AlertTriangle,
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  INFO: { icon: Info, className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
};

interface AlertsPanelProps {
  health: Pick<SystemHealthFieldsFragment, 'alerts' | 'alertsAvailable'> | undefined;
}

export function AlertsPanel({ health }: AlertsPanelProps) {
  const t = useTranslations('adminMonitoring.alerts');
  const { format } = useFormatDate();

  return (
    <Card data-testid={ids.alertsPanel}>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!health ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !health.alertsAvailable ? (
          <p
            className="flex items-start gap-2 text-sm text-muted-foreground"
            data-testid={ids.alertsUnavailable}
          >
            <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('unavailable')}
          </p>
        ) : health.alerts.length === 0 ? (
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid={ids.alertsEmpty}
          >
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {health.alerts.map((alert) => {
              const sev = SEVERITY[alert.severity];
              const Icon = sev.icon;
              return (
                <li
                  key={`${alert.name}-${alert.since}`}
                  className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
                  data-testid={ids.alertItem(alert.name)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn(sev.className)}>
                      <Icon aria-hidden="true" />
                      {t(`severity.${alert.severity}`)}
                    </Badge>
                    <span className="font-mono text-sm font-semibold">{alert.name}</span>
                  </div>
                  <p className="text-sm">{alert.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('since', { time: format(new Date(alert.since), 'dd/MM/yyyy HH:mm') })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
