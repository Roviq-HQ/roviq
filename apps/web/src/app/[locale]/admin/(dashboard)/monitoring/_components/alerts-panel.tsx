'use client';

import type { AlertSeverity } from '@roviq/graphql/generated';
import { useFormatDate } from '@roviq/i18n';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CloudOff,
  Info,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ALERT_TARGET, ALERT_TARGET_PATH, runbookUrl } from '../_lib/alert-guide';
import type { SystemHealthFieldsFragment } from '../_lib/system-health.graphql.generated';

type ActiveAlert = SystemHealthFieldsFragment['alerts'][number];
const STEP_KEYS = ['step1', 'step2', 'step3'] as const;
const CHANNELS = new Set(['EMAIL', 'PUSH', 'SMS', 'WHATSAPP']);

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
            {[...health.alerts]
              .sort((a, b) => Number(b.stillTrue) - Number(a.stillTrue))
              .map((alert) => (
                <AlertItem key={`${alert.name}-${alert.since}`} alert={alert} />
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What happened, which one, who is affected, the first steps, where to take them and the
 * runbook (docs/frontend.md → "Messages that report a problem"). A rule without copy shows the
 * description the metrics store holds.
 */
function AlertItem({ alert }: { alert: ActiveAlert }) {
  const t = useTranslations('adminMonitoring.alerts');
  const tc = useTranslations('adminMonitoring.notifications.channels');
  const { format } = useFormatDate();
  const locale = useLocale();
  const rule = `rules.${alert.name}`;
  const hasCopy = t.has(`${rule}.title`);
  const sev = SEVERITY[alert.severity];
  const Icon = sev.icon;
  const target = ALERT_TARGET[alert.name];
  const runbook = runbookUrl(alert.runbook);
  const steps = hasCopy ? STEP_KEYS.filter((k) => t.has(`${rule}.${k}`)) : [];
  const labelText = (label: string, value: string) =>
    label === 'channel' && CHANNELS.has(value) ? tc(value) : value;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 py-3 first:pt-0 last:pb-0',
        !alert.stillTrue && 'opacity-70',
      )}
      data-testid={ids.alertItem(alert.name)}
    >
      <div className="flex flex-wrap items-center gap-2">
        {alert.stillTrue ? (
          <Badge className={cn(sev.className)}>
            <Icon aria-hidden="true" />
            {t(`severity.${alert.severity}`)}
          </Badge>
        ) : (
          <Badge
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            data-testid={ids.alertRecovered(alert.name)}
          >
            <CheckCircle2 aria-hidden="true" />
            {t('recovered')}
          </Badge>
        )}
        <span className="font-semibold">{hasCopy ? t(`${rule}.title`) : alert.message}</span>
        {alert.affected.length > 0 ? (
          <span className="flex flex-wrap gap-1" data-testid={ids.alertAffected(alert.name)}>
            {alert.affected.map((a) => (
              <Badge key={`${a.label}=${a.value}`} variant="outline">
                {labelText(a.label, a.value)}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{alert.name}</p>
      {hasCopy ? <p className="text-sm">{t(`${rule}.impact`)}</p> : null}
      {alert.stillTrue && steps.length > 0 ? (
        <ol
          className="ms-5 list-decimal text-sm marker:text-muted-foreground"
          data-testid={ids.alertSteps(alert.name)}
        >
          {steps.map((k) => (
            <li key={k}>{t(`${rule}.${k}`)}</li>
          ))}
        </ol>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t('since', { time: format(new Date(alert.since), 'dd/MM/yyyy HH:mm') })}
      </p>
      {alert.stillTrue && (target || runbook) ? (
        <div className="flex flex-wrap gap-2">
          {target ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/${locale}${ALERT_TARGET_PATH[target]}`}
                data-testid={ids.alertAction(alert.name)}
              >
                {t(`actions.${target}`)}
              </Link>
            </Button>
          ) : null}
          {runbook ? (
            <Button asChild size="sm" variant="ghost">
              <a
                href={runbook}
                target="_blank"
                rel="noreferrer"
                data-testid={ids.alertRunbook(alert.name)}
              >
                <BookOpen aria-hidden="true" />
                {t('runbook')}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
