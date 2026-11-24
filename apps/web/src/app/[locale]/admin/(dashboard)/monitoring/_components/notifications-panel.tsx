'use client';

import { useQuery } from '@roviq/graphql';
import type { MessagingSenderStatus } from '@roviq/graphql/generated';
import { useFormatDate, useFormatNumber } from '@roviq/i18n';
import {
  Badge,
  Can,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertTriangle, CheckCircle2, CloudOff, Pause } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AdminMonitoringSendersDocument,
  AdminNotificationHealthDocument,
  type AdminNotificationHealthQuery,
} from '../_lib/notification-health.graphql.generated';
import { SectionError } from './section-error';

const { adminMonitoring: ids } = testIds;

export const NOTIFICATION_HEALTH_POLL_MS = 60_000;
/** The canary runs every 15 minutes; the `notification_canary_missing` alert fires after 30. */
export const CANARY_LATE_MS = 30 * 60 * 1000;

type Health = AdminNotificationHealthQuery['adminNotificationHealth'];

export function NotificationsPanel() {
  const t = useTranslations('adminMonitoring.notifications');
  const { data, error, refetch } = useQuery(AdminNotificationHealthDocument, {
    pollInterval: NOTIFICATION_HEALTH_POLL_MS,
  });
  const health = data?.adminNotificationHealth;

  return (
    <Card data-testid={ids.notificationsPanel}>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && !health ? (
          <SectionError
            error={error}
            onRetry={() => void refetch()}
            testId={ids.notificationsError}
            retryTestId={ids.notificationsRetryBtn}
          />
        ) : !health ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ChannelTable health={health} />
        )}
        <Can I="read" a="MessagingSender">
          <SendersList />
        </Can>
      </CardContent>
    </Card>
  );
}

function ChannelTable({ health }: { health: Health }) {
  const t = useTranslations('adminMonitoring.notifications');
  const { format } = useFormatNumber();
  const canary = new Map(health.canary.map((c) => [c.channel, c.lastSuccessAt]));
  const checkedAt = new Date(health.checkedAt).getTime();

  return (
    <div className="flex flex-col gap-2">
      {health.metricsAvailable ? null : (
        <p
          className="flex items-start gap-2 text-sm text-muted-foreground"
          data-testid={ids.notificationsMetricsUnavailable}
        >
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('metricsUnavailable')}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('channel')}</TableHead>
            <TableHead className="text-end">{t('sent24h')}</TableHead>
            <TableHead className="text-end">{t('failed24h')}</TableHead>
            <TableHead>{t('canary')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {health.channels.map((row) => (
            <TableRow key={row.channel} data-testid={ids.notificationsChannel(row.channel)}>
              <TableCell className="font-medium">{t(`channels.${row.channel}`)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {row.sent24h === null ? '—' : format(row.sent24h)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-end tabular-nums',
                  row.failed24h ? 'font-semibold text-destructive' : undefined,
                )}
              >
                {row.failed24h === null ? '—' : format(row.failed24h)}
              </TableCell>
              <TableCell>
                <CanaryCell lastSuccessAt={canary.get(row.channel) ?? null} checkedAt={checkedAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CanaryCell({
  lastSuccessAt,
  checkedAt,
}: {
  lastSuccessAt: string | null;
  checkedAt: number;
}) {
  const t = useTranslations('adminMonitoring.notifications');
  const { formatDistance } = useFormatDate();
  if (lastSuccessAt === null) {
    return <span className="text-sm text-muted-foreground">{t('canaryNever')}</span>;
  }
  const at = new Date(lastSuccessAt);
  const late = checkedAt - at.getTime() > CANARY_LATE_MS;
  const ago = formatDistance(at, Math.max(checkedAt, at.getTime()));
  return (
    <time
      dateTime={lastSuccessAt}
      className={cn(
        'flex items-center gap-1.5 text-sm',
        late ? 'font-semibold text-destructive' : 'text-muted-foreground',
      )}
    >
      {late ? (
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      {late ? t('canaryLate', { time: ago }) : t('canaryOk', { time: ago })}
    </time>
  );
}

const SENDER_STATUS: Record<MessagingSenderStatus, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  PAUSED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  BLOCKED: 'bg-destructive/10 text-destructive',
};

function SendersList() {
  const t = useTranslations('adminMonitoring.notifications');
  const { data, error, refetch } = useQuery(AdminMonitoringSendersDocument, {
    pollInterval: NOTIFICATION_HEALTH_POLL_MS,
  });
  const senders = data?.adminMessagingSenders;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="notification-senders-heading">
      <h3 id="notification-senders-heading" className="text-sm font-semibold">
        {t('sendersHeading')}
      </h3>
      {error && !senders ? (
        <SectionError
          error={error}
          onRetry={() => void refetch()}
          testId={ids.notificationsSendersError}
          retryTestId={ids.notificationsRetryBtn}
        />
      ) : !senders ? (
        <Skeleton className="h-8 w-full" aria-busy="true" />
      ) : senders.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid={ids.notificationsSendersEmpty}>
          {t('sendersEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {senders.map((sender) => (
            <li
              key={sender.id}
              className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"
              data-testid={ids.notificationsSender(sender.id)}
            >
              <span className="font-mono text-sm">{sender.displayNumber}</span>
              <span className="text-xs text-muted-foreground">
                {sender.tenantId === null ? t('senderPlatform') : t('senderInstitute')}
              </span>
              <Badge className={cn('ms-auto', SENDER_STATUS[sender.status])}>
                {sender.status === 'BLOCKED' ? (
                  <AlertTriangle aria-hidden="true" />
                ) : sender.status === 'PAUSED' ? (
                  <Pause aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                {t(`senderStatus.${sender.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
